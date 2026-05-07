import type { DetectedAnomaly } from '../types';

/**
 * Flag categories whose this-week spend is statistically far above its own
 * trailing baseline. Designed to catch real spikes ("groceries 3× normal")
 * without flooding on holidays/one-offs.
 *
 * Approach:
 *  - For each category, compute weekly spend totals over the trailing 12
 *    complete weeks PLUS this in-progress week. We compare this week to the
 *    prior 12.
 *  - Flag if this week > μ + 2σ AND > 1.5 × μ (the second guard prevents
 *    flagging a category whose σ is large but mean is tiny — e.g. a category
 *    with one ₪50 charge per quarter).
 *  - We only run on full weeks of history. Skip categories with fewer than
 *    6 weeks of non-zero data — too thin a baseline.
 *  - Skip weeks with <= 0 spend (income/refund weeks shouldn't trigger).
 *
 * Severity:
 *  - 'high' if z-score >= 3 OR ratio >= 3×
 *  - 'medium' otherwise
 */

const MIN_NONZERO_WEEKS = 6;
const Z_SCORE_THRESHOLD = 2;
const RATIO_THRESHOLD = 1.5;
const HIGH_Z_SCORE = 3;
const HIGH_RATIO = 3;

export interface CategorySpikeTransaction {
    category: string | null;
    amount: number;        // signed; charges are negative.
    date: Date | string;
}

export interface CategorySpikeOptions {
    /** Reference "today" for week boundary computation. Defaults to new Date(). */
    now?: Date;
}

export function detectCategorySpikes(
    transactions: CategorySpikeTransaction[],
    options: CategorySpikeOptions = {},
): DetectedAnomaly[] {
    const now = options.now ?? new Date();
    const out: DetectedAnomaly[] = [];

    // Bucket transactions by (category, ISO week label). Only consider
    // outflows (negative amounts) — income/refunds aren't spikes.
    type WeekKey = string; // YYYY-WW
    const byCategory = new Map<string, Map<WeekKey, { spend: number }>>();

    for (const t of transactions) {
        if (!t.category) continue;
        const date = t.date instanceof Date ? t.date : new Date(t.date);
        if (Number.isNaN(date.getTime())) continue;
        if (t.amount >= 0) continue; // income / refund

        const week = isoWeekKey(date);
        let weeks = byCategory.get(t.category);
        if (!weeks) {
            weeks = new Map();
            byCategory.set(t.category, weeks);
        }
        const bucket = weeks.get(week) ?? { spend: 0 };
        bucket.spend += Math.abs(t.amount);
        weeks.set(week, bucket);
    }

    const thisWeek = isoWeekKey(now);

    for (const [category, weeks] of byCategory) {
        const thisWeekData = weeks.get(thisWeek);
        if (!thisWeekData || thisWeekData.spend <= 0) continue;

        // Build the prior-weeks series excluding this in-progress week.
        const priors = [...weeks.entries()]
            .filter(([w]) => w !== thisWeek && w < thisWeek)
            .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest first
            .slice(0, 12)                            // trailing 12 weeks
            .map(([, v]) => v.spend);

        if (priors.length < MIN_NONZERO_WEEKS) continue;

        const mean = priors.reduce((s, v) => s + v, 0) / priors.length;
        if (mean <= 0) continue;
        const variance = priors.reduce((s, v) => s + (v - mean) ** 2, 0) / priors.length;
        const stdev = Math.sqrt(variance);

        const z = stdev > 0 ? (thisWeekData.spend - mean) / stdev : (thisWeekData.spend > mean ? Infinity : 0);
        const ratio = thisWeekData.spend / mean;

        if (z < Z_SCORE_THRESHOLD) continue;
        if (ratio < RATIO_THRESHOLD) continue;

        const severity: 'high' | 'medium' = (z >= HIGH_Z_SCORE || ratio >= HIGH_RATIO) ? 'high' : 'medium';
        const fingerprint = `category_spike|${category}|${thisWeek}`;

        const meanStr = mean.toFixed(0);
        const spendStr = thisWeekData.spend.toFixed(0);
        const ratioStr = ratio.toFixed(1).replace(/\.0$/, '');

        out.push({
            type: 'category_spike',
            severity,
            fingerprint,
            title: `${category}: ₪${spendStr} this week (${ratioStr}× usual)`,
            body: `Spend on ${category} this week is ₪${spendStr}, vs. typical ₪${meanStr} per week over the prior ${priors.length} weeks.`,
            payload: {
                category,
                week: thisWeek,
                thisWeekSpend: Number(thisWeekData.spend.toFixed(2)),
                priorMean: Number(mean.toFixed(2)),
                priorStdev: Number(stdev.toFixed(2)),
                zScore: Number(z.toFixed(2)),
                ratio: Number(ratio.toFixed(2)),
                priorWeeks: priors.length,
            },
        });
    }

    return out;
}

/**
 * ISO-8601 week label "YYYY-Www". Same Monday-as-start-of-week convention
 * the rest of the app likely uses, but importantly, deterministic and stable
 * across sync runs in the same week.
 */
function isoWeekKey(d: Date): string {
    // Work in UTC throughout so the result is independent of the runtime
    // timezone — important since tests don't always run with TZ=UTC.
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export const _testing = { isoWeekKey };
