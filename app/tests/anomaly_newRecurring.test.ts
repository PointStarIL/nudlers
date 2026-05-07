import { describe, it, expect } from 'vitest';
import { detectNewRecurring } from '../utils/anomaly/detectors/newRecurring';
import type { DetectedRecurringPayment } from '../utils/recurringDetection';

function makeRecurring(opts: {
    name: string;
    occurrences: Array<{ date: string; amount: number }>;
    frequency?: 'monthly' | 'bi-monthly';
    accountNumber?: string | null;
    monthlyAmount?: number;
}): DetectedRecurringPayment {
    const occurrences = opts.occurrences.map((o) => ({ date: new Date(o.date), amount: o.amount }));
    const last = occurrences[0];
    const monthlyAmount = opts.monthlyAmount ?? Math.abs(last.amount);
    return {
        name: opts.name,
        category: null,
        account_number: opts.accountNumber ?? '1234',
        monthly_amount: monthlyAmount,
        price: last.amount,
        month_count: occurrences.length,
        last_charge_date: last.date,
        frequency: opts.frequency ?? 'monthly',
        months: [],
        occurrences,
        next_payment_date: new Date(),
    } as DetectedRecurringPayment;
}

describe('detectNewRecurring', () => {
    it('flags a freshly-formed monthly recurring (2 charges)', () => {
        const r = makeRecurring({
            name: 'Strava Premium',
            occurrences: [
                { date: '2026-04-12', amount: -34.99 },
                { date: '2026-03-12', amount: -34.99 },
            ],
        });
        const out = detectNewRecurring([r]);
        expect(out).toHaveLength(1);
        expect(out[0].type).toBe('new_recurring');
        expect(out[0].title).toContain('Strava');
        expect(out[0].payload.monthCount).toBe(2);
    });

    it('flags a 3rd-charge confirmation', () => {
        const r = makeRecurring({
            name: 'NYTimes',
            occurrences: [
                { date: '2026-04-12', amount: -25 },
                { date: '2026-03-12', amount: -25 },
                { date: '2026-02-12', amount: -25 },
            ],
        });
        const out = detectNewRecurring([r]);
        expect(out).toHaveLength(1);
        expect(out[0].payload.monthCount).toBe(3);
    });

    it('does NOT flag long-running recurring (month_count >= 4)', () => {
        const r = makeRecurring({
            name: 'Spotify',
            occurrences: [
                { date: '2026-04-12', amount: -19.9 },
                { date: '2026-03-12', amount: -19.9 },
                { date: '2026-02-12', amount: -19.9 },
                { date: '2026-01-12', amount: -19.9 },
            ],
        });
        expect(detectNewRecurring([r])).toEqual([]);
    });

    it('does NOT flag bi-monthly recurring (too noisy at this stage)', () => {
        const r = makeRecurring({
            name: 'Insurance',
            occurrences: [
                { date: '2026-04-12', amount: -120 },
                { date: '2026-02-12', amount: -120 },
            ],
            frequency: 'bi-monthly',
        });
        expect(detectNewRecurring([r])).toEqual([]);
    });

    it('uses high severity for >= ₪50/month subs', () => {
        const r = makeRecurring({
            name: 'Big Sub',
            occurrences: [
                { date: '2026-04-12', amount: -65 },
                { date: '2026-03-12', amount: -65 },
            ],
        });
        const out = detectNewRecurring([r]);
        expect(out[0].severity).toBe('high');
    });

    it('uses medium severity for cheaper subs', () => {
        const r = makeRecurring({
            name: 'Cheap Sub',
            occurrences: [
                { date: '2026-04-12', amount: -9.99 },
                { date: '2026-03-12', amount: -9.99 },
            ],
        });
        const out = detectNewRecurring([r]);
        expect(out[0].severity).toBe('medium');
    });

    it('produces a stable fingerprint between the 2nd and 3rd month sightings', () => {
        const month2 = makeRecurring({
            name: 'Strava',
            occurrences: [
                { date: '2026-04-12', amount: -34.99 },
                { date: '2026-03-12', amount: -34.99 },
            ],
        });
        const month3 = makeRecurring({
            name: 'Strava',
            occurrences: [
                { date: '2026-05-12', amount: -34.99 },
                { date: '2026-04-12', amount: -34.99 },
                { date: '2026-03-12', amount: -34.99 },
            ],
        });
        const a = detectNewRecurring([month2])[0];
        const b = detectNewRecurring([month3])[0];
        // Same merchant + same first-seen month → same fingerprint, so the
        // database UPSERT won't double-flag this when we run again next month.
        expect(a.fingerprint).toBe(b.fingerprint);
    });
});
