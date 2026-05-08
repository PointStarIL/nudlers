import type { DetectedAnomaly } from '../types';
import { normalizeMerchant } from '../normalize';

/**
 * Flag price hikes on established recurring-style merchants.
 *
 * Why this doesn't reuse `detectRecurringPayments`'s output: the existing
 * recurring detector clusters by amount (10% tolerance). A real price hike
 * (e.g. ₪19.90 → ₪29.90) forms a *separate* cluster, so the hike charge
 * never lands in the recurring pattern's `occurrences`. To actually detect
 * the hike we need to work directly off the per-merchant transaction stream.
 *
 * Algorithm:
 *  - Group transactions by normalized merchant name + account.
 *  - Within each group, sort newest-first.
 *  - Require at least 4 charges and at least 3 of them tightly clustered
 *    on amount (the "stable plateau") spanning ≥3 distinct calendar months.
 *  - The most recent charge becomes the candidate. If it's materially higher
 *    than the plateau's median, flag it.
 *
 * Why median instead of mean (was the prior-art): a single one-off purchase
 * from the same merchant (e.g. a one-time ₪200 Amazon order in a stream of
 * ₪50 charges) used to drag the running mean and either let an outlier into
 * the plateau or break the walker prematurely. Median is robust to a single
 * stray value at the same N. With the small windows we deal with (≥3),
 * median is also functionally a "trimmed median" — at N=3 it's the middle
 * value; at N=4 it's the mean of the two middle values. No need for separate
 * trim logic.
 *
 * Why ≥3 distinct months: a merchant that drops 3 charges of the same
 * amount inside a single month (some non-recurring service that happens to
 * bill in chunks) shouldn't form a "plateau" the next month's normal charge
 * gets compared against. The distinct-months guard keeps us honest about
 * what "recurring" means.
 *
 * Tunable thresholds:
 *  - >= 15% jump AND >= ₪5 absolute (so ₪0.50 → ₪0.60 noise doesn't fire).
 *  - severity 'high' if the jump is >= 25%, otherwise 'medium'.
 *  - "Stable plateau" = ≥3 charges within 10% of the running median,
 *    spanning ≥3 distinct calendar months.
 */

const PRICE_HIKE_RELATIVE_THRESHOLD = 0.15;
const PRICE_HIKE_ABSOLUTE_THRESHOLD = 5;
const HIGH_SEVERITY_RELATIVE = 0.25;
// Slightly looser tolerance than the old 8%: median is more stable than
// mean, so we can afford a wider band before declaring the plateau broken
// without inviting false positives.
const STABLE_HISTORY_TOLERANCE = 0.10;
const MIN_STABLE_HISTORY = 3;
const MIN_DISTINCT_MONTHS = 3;

export interface PriceHikeTransaction {
    name: string;
    price: number;          // signed; charges are negative.
    account_number?: string | null;
    date: Date | string;
}

export function detectPriceHikes(transactions: PriceHikeTransaction[]): DetectedAnomaly[] {
    // Bucket by (normalized merchant, account).
    const byMerchant = new Map<string, PriceHikeTransaction[]>();
    for (const t of transactions) {
        if (t.price >= 0) continue; // ignore credits/refunds
        const key = `${normalizeMerchant(t.name)}|${t.account_number ?? 'na'}`;
        let arr = byMerchant.get(key);
        if (!arr) {
            arr = [];
            byMerchant.set(key, arr);
        }
        arr.push(t);
    }

    const out: DetectedAnomaly[] = [];

    for (const [, txs] of byMerchant) {
        if (txs.length < MIN_STABLE_HISTORY + 1) continue;

        // Newest first.
        const sorted = txs
            .slice()
            .sort((a, b) => toMs(b.date) - toMs(a.date));

        const latest = sorted[0];
        const priors = sorted.slice(1);
        const latestAbs = Math.abs(latest.price);

        // Find the most recent run of "stable" prior charges (consecutive,
        // within tolerance of each other) spanning ≥ MIN_DISTINCT_MONTHS
        // distinct calendar months. The plateau guard keeps us from flagging
        // a hike when history was already noisy — there has to be a real
        // baseline for the latest charge to deviate from.
        const stableBaseline = findStableHistoryMedian(
            priors,
            MIN_STABLE_HISTORY,
            MIN_DISTINCT_MONTHS,
            STABLE_HISTORY_TOLERANCE,
        );
        if (stableBaseline == null) continue;

        const diff = latestAbs - stableBaseline;
        const relative = diff / stableBaseline;
        if (relative < PRICE_HIKE_RELATIVE_THRESHOLD) continue;
        if (diff < PRICE_HIKE_ABSOLUTE_THRESHOLD) continue;

        const latestDate = new Date(latest.date);
        const monthKey = `${latestDate.getUTCFullYear()}-${String(latestDate.getUTCMonth() + 1).padStart(2, '0')}`;
        const fingerprint = [
            'price_hike',
            normalizeMerchant(latest.name),
            latest.account_number ?? 'na',
            stableBaseline.toFixed(2),
            latestAbs.toFixed(2),
            monthKey,
        ].join('|');

        const severity = relative >= HIGH_SEVERITY_RELATIVE ? 'high' : 'medium';
        const pct = Math.round(relative * 100);
        const fromIls = stableBaseline.toFixed(2).replace(/\.00$/, '');
        const toIls = latestAbs.toFixed(2).replace(/\.00$/, '');

        out.push({
            type: 'price_hike',
            severity,
            fingerprint,
            title: `${latest.name}: ₪${fromIls} → ₪${toIls}`,
            body: `Recurring charge from ${latest.name} jumped ${pct}% — was ₪${fromIls} for several months, now ₪${toIls}.`,
            payload: {
                merchant: latest.name,
                // Field name is preserved for back-compat with existing rows
                // and the Telegram/WhatsApp digest formatter; the value is now
                // the median, which is a more robust "typical" than the mean.
                priorAverage: Number(stableBaseline.toFixed(2)),
                newAmount: Number(latestAbs.toFixed(2)),
                relativeChange: Number(relative.toFixed(4)),
                accountNumber: latest.account_number ?? null,
                latestChargeDate: latestDate.toISOString(),
            },
        });
    }

    return out;
}

/**
 * Walk the prior-history (newest-first) looking for a consecutive run of
 * `minLength` charges whose amounts are all within `tolerance` of their
 * *running median* and which span at least `minMonths` distinct calendar
 * months. Returns that run's median, or null if no such run exists.
 *
 * Why median (not mean): a single outlier in the early window — say one
 * one-off ₪200 Amazon order in a stream of ₪50 monthly charges — used to
 * drag the running mean and either reject the legitimate next charge or
 * accept the outlier into the plateau. Median is robust to one weird
 * value at every plateau size we ever build (≥3 charges).
 *
 * Why distinct-months: 3 charges from the same merchant inside a single
 * calendar month don't represent a "stable monthly" plateau — they're
 * just three charges. Requiring distinct months means the plateau has to
 * actually look recurring.
 */
function findStableHistoryMedian(
    priors: PriceHikeTransaction[],
    minLength: number,
    minMonths: number,
    tolerance: number,
): number | null {
    if (priors.length < minLength) return null;
    const window: PriceHikeTransaction[] = [];
    for (const t of priors) {
        const a = Math.abs(t.price);
        if (window.length === 0) {
            window.push(t);
            continue;
        }
        const med = median(window.map((w) => Math.abs(w.price)));
        if (med === 0) return null;
        if (Math.abs(a - med) / med <= tolerance) {
            window.push(t);
            if (window.length >= minLength) {
                const monthsSpanned = new Set(
                    window.map((w) => monthKey(w.date)),
                ).size;
                if (monthsSpanned >= minMonths) {
                    // Found a qualifying plateau — return its median.
                    return median(window.map((w) => Math.abs(w.price)));
                }
                // Cluster size is right but not enough months yet — keep
                // walking; an older same-amount charge from a different
                // month may complete the requirement.
            }
        } else {
            // Plateau broken; restart from this point.
            window.length = 0;
            window.push(t);
        }
    }
    return null;
}

function median(nums: number[]): number {
    if (nums.length === 0) return 0;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthKey(d: Date | string): string {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toMs(d: Date | string): number {
    return d instanceof Date ? d.getTime() : new Date(d).getTime();
}
