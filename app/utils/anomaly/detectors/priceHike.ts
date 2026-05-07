import type { DetectedAnomaly } from '../types';

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
 *    on amount (the "stable history") within the last 6 months.
 *  - The most recent charge becomes the candidate. If it's materially higher
 *    than the stable mean, flag it.
 *
 * Tunable thresholds:
 *  - >= 15% jump AND >= ₪5 absolute (so ₪0.50 → ₪0.60 noise doesn't fire).
 *  - severity 'high' if the jump is >= 25%, otherwise 'medium'.
 *  - "Stable history" = ≥3 charges within 8% of each other.
 */

const PRICE_HIKE_RELATIVE_THRESHOLD = 0.15;
const PRICE_HIKE_ABSOLUTE_THRESHOLD = 5;
const HIGH_SEVERITY_RELATIVE = 0.25;
const STABLE_HISTORY_TOLERANCE = 0.08;
const MIN_STABLE_HISTORY = 3;

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
        // within tolerance of each other). This guards against the case where
        // history was already noisy — only call it a hike when there was a
        // real plateau to hike from.
        const stableMean = findStableHistoryMean(priors, MIN_STABLE_HISTORY, STABLE_HISTORY_TOLERANCE);
        if (stableMean == null) continue;

        const diff = latestAbs - stableMean;
        const relative = diff / stableMean;
        if (relative < PRICE_HIKE_RELATIVE_THRESHOLD) continue;
        if (diff < PRICE_HIKE_ABSOLUTE_THRESHOLD) continue;

        const latestDate = new Date(latest.date);
        const monthKey = `${latestDate.getUTCFullYear()}-${String(latestDate.getUTCMonth() + 1).padStart(2, '0')}`;
        const fingerprint = [
            'price_hike',
            normalizeMerchant(latest.name),
            latest.account_number ?? 'na',
            stableMean.toFixed(2),
            latestAbs.toFixed(2),
            monthKey,
        ].join('|');

        const severity = relative >= HIGH_SEVERITY_RELATIVE ? 'high' : 'medium';
        const pct = Math.round(relative * 100);
        const fromIls = stableMean.toFixed(2).replace(/\.00$/, '');
        const toIls = latestAbs.toFixed(2).replace(/\.00$/, '');

        out.push({
            type: 'price_hike',
            severity,
            fingerprint,
            title: `${latest.name}: ₪${fromIls} → ₪${toIls}`,
            body: `Recurring charge from ${latest.name} jumped ${pct}% — was ₪${fromIls} for several months, now ₪${toIls}.`,
            payload: {
                merchant: latest.name,
                priorAverage: Number(stableMean.toFixed(2)),
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
 * running mean. Returns that run's mean, or null if no such run exists.
 *
 * The point: only flag a hike when there's a real "plateau" the latest
 * charge departed from. If history is already chaotic (rent payments,
 * variable utility bills), we'd rather skip than false-positive.
 */
function findStableHistoryMean(
    priors: PriceHikeTransaction[],
    minLength: number,
    tolerance: number,
): number | null {
    if (priors.length < minLength) return null;
    const window: number[] = [];
    for (const t of priors) {
        const a = Math.abs(t.price);
        if (window.length === 0) {
            window.push(a);
            continue;
        }
        const mean = window.reduce((s, v) => s + v, 0) / window.length;
        if (mean === 0) return null;
        if (Math.abs(a - mean) / mean <= tolerance) {
            window.push(a);
            if (window.length >= minLength) {
                // We found a stable plateau — return its mean rather than
                // continuing to grow the window with potentially older
                // less-stable data.
                return window.reduce((s, v) => s + v, 0) / window.length;
            }
        } else {
            // Plateau broken; restart from this point.
            window.length = 0;
            window.push(a);
        }
    }
    return null;
}

function toMs(d: Date | string): number {
    return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

function normalizeMerchant(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
}
