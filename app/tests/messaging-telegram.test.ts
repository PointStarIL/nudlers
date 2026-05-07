import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { telegramProvider, verifyTelegramToken } from '../utils/messaging/telegramProvider.js';

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const baseSettings = {
    whatsapp_enabled: false,
    whatsapp_to: '',
    whatsapp_notify_on_restart: false,
    telegram_enabled: true,
    telegram_bot_token: 'TEST_TOKEN',
    telegram_to: '12345',
    telegram_notify_on_restart: false,
};

describe('telegramProvider.isEnabled', () => {
    it('disabled when telegram_enabled is false', () => {
        expect(telegramProvider.isEnabled('daily_summary', { ...baseSettings, telegram_enabled: false })).toBe(false);
    });

    it('disabled when token is missing', () => {
        expect(telegramProvider.isEnabled('daily_summary', { ...baseSettings, telegram_bot_token: '' })).toBe(false);
    });

    it('disabled when no recipients', () => {
        expect(telegramProvider.isEnabled('daily_summary', { ...baseSettings, telegram_to: '' })).toBe(false);
    });

    it('enabled for daily_summary when fully configured', () => {
        expect(telegramProvider.isEnabled('daily_summary', baseSettings)).toBe(true);
    });

    it('restart_notify requires the dedicated opt-in toggle', () => {
        expect(telegramProvider.isEnabled('restart_notify', baseSettings)).toBe(false);
        expect(telegramProvider.isEnabled('restart_notify', { ...baseSettings, telegram_notify_on_restart: true })).toBe(true);
    });
});

describe('telegramProvider.send', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const origFetch = globalThis.fetch;

    beforeEach(() => {
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    function jsonResponse(body: object, ok = true, status = 200) {
        return {
            ok,
            status,
            json: async () => body,
        } as unknown as Response;
    }

    it('POSTs to /sendMessage for a single recipient and returns success', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ ok: true, result: { message_id: 99 } })
        );

        const result = await telegramProvider.send(
            { body: 'hello', purpose: 'daily_summary' },
            baseSettings
        );

        expect(result.success).toBe(true);
        expect(result.sent).toBe(1);
        expect(result.total).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/botTEST_TOKEN/sendMessage');
        expect(init.method).toBe('POST');
        const payload = JSON.parse(init.body);
        expect(payload.chat_id).toBe('12345');
        expect(payload.text).toBe('hello');
        expect(payload.disable_web_page_preview).toBe(true);
    });

    it('handles multiple comma-separated recipients with partial failure', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 1 } }))
            .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'chat not found' }, false, 400));

        const result = await telegramProvider.send(
            { body: 'fan-out', purpose: 'daily_summary' },
            { ...baseSettings, telegram_to: '12345, -1001234567890' }
        );

        expect(result.success).toBe(true);
        expect(result.sent).toBe(1);
        expect(result.total).toBe(2);
        expect(result.results).toHaveLength(2);
        expect(result.results![0].success).toBe(true);
        expect(result.results![1].success).toBe(false);
        expect(result.results![1].error).toContain('chat not found');
    });

    it('throws when ALL recipients fail (signals dispatcher to mark this provider failed)', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'forbidden' }, false, 403))
            .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'forbidden' }, false, 403));

        await expect(
            telegramProvider.send(
                { body: 'fail', purpose: 'daily_summary' },
                { ...baseSettings, telegram_to: '1, 2' }
            )
        ).rejects.toThrow(/Telegram failed for all/);
    });

    it('throws when there are no recipients at all', async () => {
        await expect(
            telegramProvider.send({ body: 'hi', purpose: 'daily_summary' }, { ...baseSettings, telegram_to: '   ' })
        ).rejects.toThrow(/no recipients/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('survives non-JSON error bodies from Telegram', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 502,
            json: async () => { throw new Error('not json'); },
        } as unknown as Response);

        await expect(
            telegramProvider.send({ body: 'hi', purpose: 'daily_summary' }, baseSettings)
        ).rejects.toThrow();
    });
});

describe('verifyTelegramToken', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const origFetch = globalThis.fetch;

    beforeEach(() => {
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    it('returns the bot info on success', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: { id: 1, username: 'mybot' } }),
        } as unknown as Response);

        const result = await verifyTelegramToken('abc');
        expect(result.username).toBe('mybot');
    });

    it('throws on a 401 with description', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({ ok: false, description: 'Unauthorized' }),
        } as unknown as Response);

        await expect(verifyTelegramToken('bad')).rejects.toThrow(/Unauthorized/);
    });

    it('rejects empty tokens without making a request', async () => {
        await expect(verifyTelegramToken('')).rejects.toThrow(/required/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
