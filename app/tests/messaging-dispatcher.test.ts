import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendNotification } from '../utils/messaging/dispatcher.js';

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeDeps(rows: Array<{ key: string; value: unknown }>) {
    const queryFn = vi.fn().mockResolvedValue({ rows });
    return {
        getDB: vi.fn().mockResolvedValue({ query: queryFn, release: vi.fn() }),
        queryFn,
    };
}

function mkProvider(id: string, opts: {
    enabled?: boolean;
    onSend?: () => Promise<unknown>;
} = {}) {
    return {
        id,
        isEnabled: vi.fn(() => opts.enabled ?? true),
        send: vi.fn(opts.onSend ?? (async () => ({ success: true, sent: 1, total: 1 }))),
    };
}

describe('sendNotification (dispatcher)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects empty body or missing purpose', async () => {
        await expect(sendNotification({ body: '', purpose: 'test' as 'test' })).rejects.toThrow();
        // @ts-expect-error: testing runtime guard
        await expect(sendNotification({ body: 'x' })).rejects.toThrow();
    });

    it('returns no_providers_enabled when nothing is opted in', async () => {
        const deps = makeDeps([]);
        const result = await sendNotification({
            body: 'hello',
            purpose: 'daily_summary',
            deps,
            providers: [mkProvider('a', { enabled: false }), mkProvider('b', { enabled: false })],
        });
        expect(result.success).toBe(false);
        expect(result.attempted).toBe(0);
        expect(result.succeeded).toBe(0);
    });

    it('fans out to every enabled provider in parallel', async () => {
        const deps = makeDeps([]);
        const a = mkProvider('a');
        const b = mkProvider('b');
        const c = mkProvider('c', { enabled: false });

        const result = await sendNotification({
            body: 'hi',
            purpose: 'daily_summary',
            deps,
            providers: [a, b, c],
        });

        expect(result.success).toBe(true);
        expect(result.attempted).toBe(2);
        expect(result.succeeded).toBe(2);
        expect(a.send).toHaveBeenCalledTimes(1);
        expect(b.send).toHaveBeenCalledTimes(1);
        expect(c.send).not.toHaveBeenCalled();
    });

    it('partial failure: one provider throws, the other still delivers', async () => {
        const deps = makeDeps([]);
        const a = mkProvider('a', {
            onSend: async () => { throw new Error('boom'); },
        });
        const b = mkProvider('b');

        const result = await sendNotification({
            body: 'hi',
            purpose: 'daily_summary',
            deps,
            providers: [a, b],
        });

        // Successful overall — b made it through.
        expect(result.success).toBe(true);
        expect(result.succeeded).toBe(1);
        expect(result.attempted).toBe(2);
        const aRes = result.results.find((r) => r.provider === 'a');
        const bRes = result.results.find((r) => r.provider === 'b');
        expect(aRes!.success).toBe(false);
        expect(aRes!.error).toContain('boom');
        expect(bRes!.success).toBe(true);
    });

    it('all providers fail → success=false, every error reported', async () => {
        const deps = makeDeps([]);
        const a = mkProvider('a', { onSend: async () => { throw new Error('e1'); } });
        const b = mkProvider('b', { onSend: async () => { throw new Error('e2'); } });

        const result = await sendNotification({
            body: 'hi',
            purpose: 'daily_summary',
            deps,
            providers: [a, b],
        });

        expect(result.success).toBe(false);
        expect(result.succeeded).toBe(0);
        expect(result.attempted).toBe(2);
        expect(result.results.every((r) => !r.success)).toBe(true);
    });

    it('passes the loaded settings into each provider isEnabled / send call', async () => {
        const deps = makeDeps([
            { key: 'whatsapp_enabled', value: 'true' },
            { key: 'whatsapp_to', value: JSON.stringify('972500000000') },
            { key: 'telegram_enabled', value: 'false' },
        ]);
        const captured: Array<{ purpose: string; settings: unknown }> = [];
        const a = {
            id: 'a',
            isEnabled: vi.fn((purpose: string, s: unknown) => {
                captured.push({ purpose, settings: s });
                return true;
            }),
            send: vi.fn(async () => ({ success: true })),
        };

        await sendNotification({
            body: 'x',
            purpose: 'daily_summary',
            deps,
            providers: [a],
        });

        expect(captured).toHaveLength(1);
        const s = captured[0].settings as Record<string, unknown>;
        expect(s.whatsapp_enabled).toBe(true);
        expect(s.whatsapp_to).toBe('972500000000');
        expect(s.telegram_enabled).toBe(false);
    });
});
