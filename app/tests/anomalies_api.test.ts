import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
// Lazy-imported by the POST handler — just stub it to avoid pulling the
// real evaluator and its detector imports into this unit test.
vi.mock('../utils/anomaly/evaluate.js', () => ({
    evaluateAnomalies: vi.fn().mockResolvedValue({ detected: 2, inserted: 1, updated: 1 }),
}));

import indexHandler from '../pages/api/anomalies/index.js';
import idHandler from '../pages/api/anomalies/[id].js';
import { getDB } from '../pages/api/db';

function makeRes() {
    const res: any = { headers: {} };
    res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v; });
    res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
    res.json = vi.fn((body: unknown) => { res.body = body; return res; });
    return res;
}

function makeMockClient(rowsByQuery: Array<{ rows: any[]; rowCount?: number }>) {
    let i = 0;
    const client = {
        query: vi.fn().mockImplementation(() => Promise.resolve(rowsByQuery[i++] ?? { rows: [], rowCount: 0 })),
        release: vi.fn(),
    };
    (getDB as any).mockResolvedValue(client);
    return client;
}

describe('GET /api/anomalies', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns anomalies + countByType for the default open status', async () => {
        makeMockClient([
            {
                rowCount: 2,
                rows: [
                    { id: 1, type: 'price_hike', severity: 'high', title: 'X', status: 'open' },
                    { id: 2, type: 'new_recurring', severity: 'medium', title: 'Y', status: 'open' },
                ],
            },
            { rows: [{ type: 'price_hike', n: 1 }, { type: 'new_recurring', n: 1 }] },
        ]);

        const req: any = { method: 'GET', query: {} };
        const res = makeRes();
        await indexHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.anomalies).toHaveLength(2);
        expect(res.body.countByType).toEqual({ price_hike: 1, new_recurring: 1 });
        expect(res.body.total).toBe(2);
        expect(res.headers['Cache-Control']).toContain('max-age');
    });

    it('rejects an unknown status filter with 400', async () => {
        const req: any = { method: 'GET', query: { status: 'bogus' } };
        const res = makeRes();
        await indexHandler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('bogus');
    });

    it('respects an explicit valid status', async () => {
        const c = makeMockClient([
            { rowCount: 0, rows: [] },
            { rows: [] },
        ]);

        const req: any = { method: 'GET', query: { status: 'dismissed' } };
        await indexHandler(req, makeRes());

        const sqlAndParams = c.query.mock.calls[0];
        expect(sqlAndParams[1]).toEqual(['dismissed']);
    });
});

describe('POST /api/anomalies (manual evaluate)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('runs the evaluator and returns its summary', async () => {
        const req: any = { method: 'POST' };
        const res = makeRes();
        await indexHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ detected: 2, inserted: 1, updated: 1 });
    });

    it('rejects non-GET/POST methods with 405', async () => {
        const req: any = { method: 'DELETE' };
        const res = makeRes();
        await indexHandler(req, res);
        expect(res.statusCode).toBe(405);
        expect(res.headers['Allow']).toEqual(['GET', 'POST']);
    });
});

describe('PATCH /api/anomalies/[id]', () => {
    beforeEach(() => vi.clearAllMocks());

    it('transitions an anomaly to acknowledged and stamps the timestamp column', async () => {
        const c = makeMockClient([
            { rowCount: 1, rows: [{ id: 7, status: 'acknowledged', acknowledged_at: '2026-04-15T10:00:00Z' }] },
        ]);

        const req: any = { method: 'PATCH', query: { id: '7' }, body: { status: 'acknowledged' } };
        const res = makeRes();
        await idHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('acknowledged');
        // SQL should mention acknowledged_at — the timestamp column for this transition.
        const [sql, params] = c.query.mock.calls[0];
        expect(sql).toContain('acknowledged_at = CURRENT_TIMESTAMP');
        expect(params).toEqual(['acknowledged', 7]);
    });

    it('transitions to "normal" without touching either timestamp column', async () => {
        const c = makeMockClient([
            { rowCount: 1, rows: [{ id: 5, status: 'normal' }] },
        ]);

        const req: any = { method: 'PATCH', query: { id: '5' }, body: { status: 'normal' } };
        await idHandler(req, makeRes());

        const sql = c.query.mock.calls[0][0];
        // acknowledged_at / dismissed_at appear in RETURNING — that's fine.
        // The thing we're guarding against is them being SET.
        expect(sql).not.toMatch(/acknowledged_at\s*=\s*CURRENT_TIMESTAMP/);
        expect(sql).not.toMatch(/dismissed_at\s*=\s*CURRENT_TIMESTAMP/);
    });

    it('returns 404 when the id does not exist', async () => {
        makeMockClient([{ rowCount: 0, rows: [] }]);

        const req: any = { method: 'PATCH', query: { id: '999' }, body: { status: 'dismissed' } };
        const res = makeRes();
        await idHandler(req, res);

        expect(res.statusCode).toBe(404);
    });

    it('rejects invalid status values', async () => {
        const req: any = { method: 'PATCH', query: { id: '7' }, body: { status: 'open' } };
        const res = makeRes();
        await idHandler(req, res);
        // 'open' isn't a valid client-driven transition.
        expect(res.statusCode).toBe(400);
    });

    it('rejects bogus ids', async () => {
        const req: any = { method: 'PATCH', query: { id: 'abc' }, body: { status: 'dismissed' } };
        const res = makeRes();
        await idHandler(req, res);
        expect(res.statusCode).toBe(400);
    });

    it('rejects non-PATCH methods', async () => {
        const req: any = { method: 'PUT', query: { id: '7' }, body: { status: 'dismissed' } };
        const res = makeRes();
        await idHandler(req, res);
        expect(res.statusCode).toBe(405);
    });
});
