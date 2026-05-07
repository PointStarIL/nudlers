import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAnomalyPreambleForSummary } from '../utils/anomaly/summaryFragment.js';

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeDB(rows: any[]) {
    const queryFn = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
    const release = vi.fn();
    return {
        getDB: vi.fn().mockResolvedValue({ query: queryFn, release }),
        queryFn,
        release,
    };
}

describe('getAnomalyPreambleForSummary', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns an empty string when no anomalies match', async () => {
        const { getDB } = makeDB([]);
        const out = await getAnomalyPreambleForSummary({ getDB });
        expect(out).toBe('');
    });

    it('formats a price-hike line in Hebrew with both old and new amounts', async () => {
        const { getDB } = makeDB([
            {
                type: 'price_hike',
                severity: 'high',
                title: 'X',
                payload: { merchant: 'Apple Music', priorAverage: 19.9, newAmount: 29.9 },
                created_at: new Date(),
            },
        ]);
        const out = await getAnomalyPreambleForSummary({ getDB });

        expect(out).toContain('🔔');
        expect(out).toContain('Apple Music');
        expect(out).toContain('19.9');
        expect(out).toContain('29.9');
        expect(out).toContain('התייקר');
        expect(out).toMatch(/---/); // visible separator before the AI summary
    });

    it('formats a new-recurring line with the monthly amount', async () => {
        const { getDB } = makeDB([
            {
                type: 'new_recurring',
                severity: 'medium',
                title: 'X',
                payload: { merchant: 'Strava Premium', monthlyAmount: 34.99 },
                created_at: new Date(),
            },
        ]);
        const out = await getAnomalyPreambleForSummary({ getDB });

        expect(out).toContain('מנוי חדש');
        expect(out).toContain('Strava Premium');
        expect(out).toContain('34.99');
    });

    it('formats a category-spike line with the ratio', async () => {
        const { getDB } = makeDB([
            {
                type: 'category_spike',
                severity: 'high',
                title: 'X',
                payload: { category: 'Groceries', thisWeekSpend: 1840, ratio: 3.2 },
                created_at: new Date(),
            },
        ]);
        const out = await getAnomalyPreambleForSummary({ getDB });

        expect(out).toContain('Groceries');
        expect(out).toContain('1840');
        expect(out).toContain('3.2× מהרגיל');
    });

    it('falls back to the title for unknown types', async () => {
        const { getDB } = makeDB([
            {
                type: 'mystery_type',
                severity: 'high',
                title: 'A surprising thing happened',
                payload: {},
                created_at: new Date(),
            },
        ]);
        const out = await getAnomalyPreambleForSummary({ getDB });
        expect(out).toContain('A surprising thing happened');
    });

    it('returns empty + logs (no throw) when the DB query fails', async () => {
        const queryFn = vi.fn().mockRejectedValue(new Error('boom'));
        const release = vi.fn();
        const getDB = vi.fn().mockResolvedValue({ query: queryFn, release });

        const out = await getAnomalyPreambleForSummary({ getDB });

        expect(out).toBe('');
        expect(release).toHaveBeenCalled();
    });

    it('issues SQL that filters last-24h + open + high|medium severity', async () => {
        const { getDB, queryFn } = makeDB([]);
        await getAnomalyPreambleForSummary({ getDB });
        const sql = queryFn.mock.calls[0][0];
        expect(sql).toContain("status = 'open'");
        expect(sql).toContain('24 hours');
        expect(sql).toMatch(/severity IN \('high', 'medium'\)/);
    });
});
