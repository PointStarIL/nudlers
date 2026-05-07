import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyAppStartedWithLockedVault } from '../utils/whatsappStartupNotify.js';

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

interface MockClient {
    once: (evt: string, cb: (...args: unknown[]) => void) => void;
    off: (evt: string, cb: (...args: unknown[]) => void) => void;
    emit: (evt: string, ...args: unknown[]) => void;
}

function makeMockClient(): MockClient {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    return {
        once: (evt, cb) => {
            const arr = listeners.get(evt) ?? [];
            arr.push(cb);
            listeners.set(evt, arr);
        },
        off: (evt, cb) => {
            const arr = listeners.get(evt);
            if (!arr) return;
            const i = arr.indexOf(cb);
            if (i >= 0) arr.splice(i, 1);
        },
        emit: (evt, ...args) => {
            const arr = listeners.get(evt) ?? [];
            const snapshot = arr.slice();
            arr.length = 0;
            snapshot.forEach((cb) => cb(...args));
        },
    };
}

function makeDB(rows: Array<{ key: string; value: unknown }>) {
    const queryFn = vi.fn().mockResolvedValue({ rows });
    return {
        getDB: vi.fn().mockResolvedValue({
            query: queryFn,
            release: vi.fn(),
        }),
        queryFn,
    };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

describe('notifyAppStartedWithLockedVault', () => {
    let mockClient: MockClient;
    let getOrCreateClient: ReturnType<typeof vi.fn>;
    let sendWhatsAppMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = makeMockClient();
        getOrCreateClient = vi.fn(() => mockClient);
        sendWhatsAppMessage = vi.fn().mockResolvedValue({ success: true, sent: 1 });
        // Default: assume WhatsApp is already up so tests don't need to fire 'ready'
        // unless they're specifically exercising the wait path.
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'READY';
    });

    afterEach(() => {
        delete (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus;
    });

    it('does NOT send when the vault is uninitialized (no wrapped key)', async () => {
        const { getDB } = makeDB([
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
            // wrapped_master_key intentionally absent
        ]);

        const result = await notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('not_initialized');
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('does NOT send when the setting is disabled', async () => {
        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(false) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
        ]);

        const result = await notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('disabled');
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('does NOT send when there are no recipients configured', async () => {
        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('') },
        ]);

        const result = await notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('no_recipients');
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('sends the message when vault is initialized + setting on + recipients configured', async () => {
        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
        ]);

        const result = await notifyAppStartedWithLockedVault({
            getDB, sendWhatsAppMessage, getOrCreateClient,
            now: new Date('2026-04-15T10:00:00Z'),
        });

        expect(result.sent).toBe(true);
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
        const call = sendWhatsAppMessage.mock.calls[0][0];
        expect(call.to).toBe('972501234567');
        // Message reflects the corrected semantics — restart with locked vault,
        // not "vault unlocked".
        expect(call.body).toContain('הופעלה מחדש');
        expect(call.body).toContain('הכספת נעולה');
        expect(call.body).not.toContain('נפתחה'); // would imply "was unlocked"
    });

    it('waits for the ready event when WhatsApp is still INITIALIZING at startup, then sends', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
        ]);

        const promise = notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });
        // Let the function read the DB and reach the wait.
        await flushMicrotasks();
        await flushMicrotasks();
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();

        // Simulate WhatsApp finishing its session restore.
        mockClient.emit('ready');
        const result = await promise;

        expect(result.sent).toBe(true);
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    it('drops the notification cleanly if WhatsApp auth fails while we wait', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
        ]);

        const promise = notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });
        await flushMicrotasks();

        mockClient.emit('auth_failure', 'session expired');
        const result = await promise;

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('whatsapp_not_ready');
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('treats wrapped_master_key set to JSON empty-string as uninitialized', async () => {
        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
        ]);

        const result = await notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });
        expect(result.reason).toBe('not_initialized');
    });

    it('handles the AUTHENTICATED status as ready (not just READY)', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'AUTHENTICATED';

        const { getDB } = makeDB([
            { key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') },
            { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(true) },
            { key: 'whatsapp_to', value: JSON.stringify('972501234567') },
        ]);

        const result = await notifyAppStartedWithLockedVault({ getDB, sendWhatsAppMessage, getOrCreateClient });

        expect(result.sent).toBe(true);
        // Didn't need to listen for ready — short-circuited.
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });
});
