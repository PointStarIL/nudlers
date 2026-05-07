import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { evaluateAnomalies } from '../utils/anomaly/evaluate.js';
import { getDB } from '../pages/api/db';

function buildPriceHikeTransactions() {
    // 4 monthly charges from "Apple Music"; the 4th is a 50% jump.
    // Dates evenly spaced 30 days apart.
    const now = new Date();
    const months = [3, 2, 1, 0]; // months ago
    const amounts = [-19.9, -19.9, -19.9, -29.9];
    return months.map((mAgo, i) => {
        const date = new Date(now);
        date.setMonth(date.getMonth() - mAgo);
        return {
            identifier: `apple-${i}`,
            vendor: 'visaCal',
            name: 'Apple Music',
            price: amounts[i],
            category: 'Subscriptions',
            account_number: '1234',
            date: date.toISOString(),
            processed_date: date.toISOString(),
            transaction_type: 'credit_card',
        };
    });
}

describe('evaluateAnomalies', () => {
    let mockClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = {
            query: vi.fn(),
            release: vi.fn(),
        };
        (getDB as any).mockResolvedValue(mockClient);
    });

    it('detects a price hike, persists it, and reports inserted=1', async () => {
        const txs = buildPriceHikeTransactions();
        mockClient.query
            // SELECT transactions
            .mockResolvedValueOnce({ rows: txs })
            // INSERT result for the price-hike row
            .mockResolvedValueOnce({ rows: [{ was_inserted: true }] });

        const summary = await evaluateAnomalies();

        expect(summary.inserted).toBe(1);
        expect(summary.updated).toBe(0);
        expect(summary.detected).toBe(1);

        // Confirm the INSERT used the right SQL shape and 'price_hike' type.
        const insertCalls = mockClient.query.mock.calls.filter((c: any[]) =>
            String(c[0]).includes('INSERT INTO anomalies'),
        );
        expect(insertCalls).toHaveLength(1);
        expect(insertCalls[0][1][0]).toBe('price_hike'); // type param
        expect(mockClient.release).toHaveBeenCalled();
    });

    it('reports updated (not inserted) when the same fingerprint already exists', async () => {
        const txs = buildPriceHikeTransactions();
        mockClient.query
            .mockResolvedValueOnce({ rows: txs })
            // The xmax=0 trick returns false when the row was UPDATEd, true when INSERTed.
            .mockResolvedValueOnce({ rows: [{ was_inserted: false }] });

        const summary = await evaluateAnomalies();

        expect(summary.inserted).toBe(0);
        expect(summary.updated).toBe(1);
    });

    it('returns 0 detected when there is nothing notable in the data', async () => {
        // Empty transaction list — no patterns to detect.
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const summary = await evaluateAnomalies();

        expect(summary.detected).toBe(0);
        expect(summary.inserted).toBe(0);
        expect(summary.updated).toBe(0);
    });

    it('releases the DB client even when detection throws', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('boom'));

        await expect(evaluateAnomalies()).rejects.toThrow('boom');
        expect(mockClient.release).toHaveBeenCalled();
    });
});
