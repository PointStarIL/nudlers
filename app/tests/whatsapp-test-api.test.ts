import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks must be declared before importing the handler so vi.mock hoisting
// resolves them for the route's transitive imports.
vi.mock('../pages/api/db.js', () => ({
    getDB: vi.fn(),
}));

vi.mock('../utils/summary.js', () => ({
    generateDailySummary: vi.fn(),
}));

vi.mock('../utils/whatsapp.js', () => ({
    sendWhatsAppMessage: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import handler from '../pages/api/whatsapp-test.js';
import { getDB } from '../pages/api/db.js';
import { generateDailySummary } from '../utils/summary.js';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';

type MockRes = {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
};

function makeRes(): MockRes {
    const res: MockRes = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

describe('POST /api/whatsapp-test', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = {
            query: vi.fn().mockResolvedValue({
                rows: [
                    { key: 'whatsapp_enabled', value: true },
                    { key: 'whatsapp_to', value: '"972501234567"' },
                ],
            }),
            release: vi.fn(),
        };
        (getDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
        (generateDailySummary as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('test summary body');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns 200 with results on a fast successful send', async () => {
        (sendWhatsAppMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: true,
            sent: 1,
            total: 1,
            results: [{ success: true, to: '972501234567', messageId: 'msg-1' }],
        });

        const res = makeRes();
        await handler({ method: 'POST' } as never, res as never);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: true, message: 'test summary body', error: null })
        );
        const payload = res.json.mock.calls[0][0];
        expect(payload.queued).toBeUndefined();
    });

    it('returns 500 when the send rejects within budget', async () => {
        (sendWhatsAppMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('not in contacts')
        );

        const res = makeRes();
        await handler({ method: 'POST' } as never, res as never);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: false, error: 'not in contacts' })
        );
    });

    it('returns 200 queued=true when the send exceeds the proxy budget', async () => {
        // Hand the handler a promise that never resolves so the timeout
        // arm of Promise.race is the only way out. This is the bug we're
        // guarding against: a slow Baileys send would otherwise let the
        // NAS reverse proxy substitute an HTML 504.
        let resolveSend: (v: unknown) => void = () => {};
        const neverResolves = new Promise((resolve) => { resolveSend = resolve; });
        (sendWhatsAppMessage as unknown as ReturnType<typeof vi.fn>).mockReturnValue(neverResolves);

        vi.useFakeTimers();
        const res = makeRes();
        const handlerPromise = handler({ method: 'POST' } as never, res as never);

        // Advance past the 20s proxy budget. Use tickAsync so the awaited
        // Promise.race actually settles inside the test.
        await vi.advanceTimersByTimeAsync(20_001);
        await handlerPromise;

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                queued: true,
                message: 'test summary body',
                error: null,
            })
        );

        // The send is still alive — settling it after the response shouldn't
        // throw an unhandledRejection. The handler attached a .catch so a
        // late failure is observed.
        resolveSend({
            success: true,
            sent: 1,
            total: 1,
            results: [{ success: true, to: '972501234567', messageId: 'late' }],
        });
    });

    it('returns 405 for non-POST methods', async () => {
        const res = makeRes();
        await handler({ method: 'GET' } as never, res as never);

        expect(res.status).toHaveBeenCalledWith(405);
    });

    it('returns 400 when whatsapp_to is missing', async () => {
        mockClient.query.mockResolvedValue({
            rows: [{ key: 'whatsapp_enabled', value: true }],
        });

        const res = makeRes();
        await handler({ method: 'POST' } as never, res as never);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: false, error: expect.stringContaining('To Number') })
        );
    });
});
