import type { DetectedAnomaly } from '../types';
import type { DetectedRecurringPayment } from '../../recurringDetection';

/**
 * Flag newly-formed recurring patterns — the "you have a new subscription"
 * signal. These are the forgotten-free-trials-that-became-charges that the
 * feature was sold on.
 *
 * What counts as new:
 *  - month_count is exactly 2 or 3 (we want to catch the second or third
 *    confirming charge, not later — by month 4+ it's no longer "new").
 *  - frequency is monthly (bi-monthly is rare and noisier; we'd over-report).
 *
 * Severity:
 *  - 'high' if the recurring amount is >= ₪50/month (likely meaningful sub).
 *  - 'medium' otherwise (small charges still worth a heads-up).
 *
 * The fingerprint is keyed on (merchant, account, first-seen month) so that
 * once we've flagged a sub on its second charge we won't flag it again on
 * its third — month_count grows but the first-seen month stays the same.
 */

const HIGH_SEVERITY_AMOUNT = 50;

export function detectNewRecurring(recurring: DetectedRecurringPayment[]): DetectedAnomaly[] {
    const out: DetectedAnomaly[] = [];

    for (const r of recurring) {
        if (r.frequency !== 'monthly') continue;
        if (r.month_count < 2 || r.month_count > 3) continue;
        if (!r.occurrences || r.occurrences.length === 0) continue;

        // occurrences are stored newest-first; the oldest one is the "first seen".
        const firstSeen = r.occurrences[r.occurrences.length - 1].date;
        const firstSeenMonth = `${firstSeen.getFullYear()}-${String(firstSeen.getMonth() + 1).padStart(2, '0')}`;

        const fingerprint = [
            'new_recurring',
            normalizeMerchant(r.name),
            r.account_number ?? 'na',
            firstSeenMonth,
        ].join('|');

        const monthlyAmount = Math.abs(r.monthly_amount);
        const severity = monthlyAmount >= HIGH_SEVERITY_AMOUNT ? 'high' : 'medium';
        const amountStr = monthlyAmount.toFixed(2).replace(/\.00$/, '');
        const seenLabel = r.month_count === 2 ? 'twice' : 'three times';

        out.push({
            type: 'new_recurring',
            severity,
            fingerprint,
            title: `New subscription: ${r.name} (₪${amountStr}/mo)`,
            body: `${r.name} has charged ₪${amountStr} ${seenLabel} now — looks like a new recurring charge.`,
            payload: {
                merchant: r.name,
                monthlyAmount: Number(monthlyAmount.toFixed(2)),
                monthCount: r.month_count,
                firstSeen: firstSeen.toISOString(),
                firstSeenMonth,
                accountNumber: r.account_number,
                category: r.category,
            },
        });
    }

    return out;
}

function normalizeMerchant(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
}
