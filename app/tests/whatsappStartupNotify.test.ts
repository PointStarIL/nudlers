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

interface MessagingSettingsOverride {
    whatsapp_enabled?: boolean;
    whatsapp_to?: string;
    whatsapp_notify_on_restart?: boolean;
    telegram_enabled?: boolean;
    telegram_bot_token?: string;
    telegram_to?: string;
    telegram_notify_on_restart?: boolean;
}

const defaultMessagingSettings: Required<MessagingSettingsOverride> = {
    whatsapp_enabled: false,
    whatsapp_to: '',
    whatsapp_notify_on_restart: false,
    telegram_enabled: false,
    telegram_bot_token: '',
    telegram_to: '',
    telegram_notify_on_restart: false,
};

function makeDeps(opts: {
    vaultInitialized: boolean;
    messaging?: MessagingSettingsOverride;
    sendOutcome?: 'success' | 'fail' | 'partial';
}) {
    const vaultRows = opts.vaultInitialized
        ? [{ key: 'wrapped_master_key', value: JSON.stringify('iv:data:tag') }]
        : [];

    const queryFn = vi.fn().mockResolvedValue({ rows: vaultRows });
    const getDB = vi.fn().mockResolvedValue({
        query: queryFn,
        release: vi.fn(),
    });

    const settings = { ...defaultMessagingSettings, ...(opts.messaging ?? {}) };
    const loadMessagingSettings = vi.fn().mockResolvedValue(settings);

    const succeeded =
        opts.sendOutcome === 'fail' ? 0 :
        opts.sendOutcome === 'partial' ? 1 : 2;
    const sendNotification = vi.fn().mockResolvedValue({
        success: succeeded > 0,
        attempted: 2,
        succeeded,
        results: [],
    });

    return { getDB, queryFn, settings, loadMessagingSettings, sendNotification };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

describe('notifyAppStartedWithLockedVault', () => {
    let mockClient: MockClient;
    let getOrCreateClient: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = makeMockClient();
        getOrCreateClient = vi.fn(() => mockClient);
        // Default: assume WhatsApp is already up so tests don't need to fire
        // 'ready' unless they're specifically exercising the wait path.
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'READY';
    });

    afterEach(() => {
        delete (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus;
    });

    it('does NOT send when the vault is uninitialized (no wrapped key)', async () => {
        const deps = makeDeps({
            vaultInitialized: false,
            messaging: { whatsapp_notify_on_restart: true, whatsapp_to: '972501234567' },
        });

        const result = await notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('not_initialized');
        expect(deps.sendNotification).not.toHaveBeenCalled();
    });

    it('does NOT send when neither channel is opted-in for restart notifications', async () => {
        const deps = makeDeps({
            vaultInitialized: true,
            messaging: {
                whatsapp_notify_on_restart: false,
                whatsapp_to: '972501234567',
                telegram_notify_on_restart: false,
            },
        });

        const result = await notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('disabled');
        expect(deps.sendNotification).not.toHaveBeenCalled();
    });

    it('does NOT send when the WA toggle is on but recipients are empty', async () => {
        const deps = makeDeps({
            vaultInitialized: true,
            messaging: { whatsapp_notify_on_restart: true, whatsapp_to: '' },
        });

        const result = await notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });

        expect(result.sent).toBe(false);
        // No usable channel — same as disabled from the dispatcher's perspective.
        expect(result.reason).toBe('disabled');
        expect(deps.sendNotification).not.toHaveBeenCalled();
    });

    it('sends through the dispatcher when WA is configured + opted-in', async () => {
        const deps = makeDeps({
            vaultInitialized: true,
            messaging: { whatsapp_notify_on_restart: true, whatsapp_to: '972501234567' },
        });

        const result = await notifyAppStartedWithLockedVault({
            ...deps,
            getOrCreateClient,
            now: new Date('2026-04-15T10:00:00Z'),
        });

        expect(result.sent).toBe(true);
        expect(deps.sendNotification).toHaveBeenCalledTimes(1);
        const call = deps.sendNotification.mock.calls[0][0];
        expect(call.purpose).toBe('restart_notify');
        // Message reflects the corrected semantics — restart with locked vault,
        // not "vault unlocked".
        expect(call.body).toContain('הופעלה מחדש');
        expect(call.body).toContain('הכספת נעולה');
        expect(call.body).not.toContain('נפתחה'); // would imply "was unlocked"
    });

    it('sends through the dispatcher for Telegram-only setups (no WA wait)', async () => {
        // Vault is initialized, only Telegram is opted in; WA must not be
        // waited for at all — getOrCreateClient should not be called.
        const deps = makeDeps({
            vaultInitialized: true,
            messaging: {
                telegram_enabled: true,
                telegram_notify_on_restart: true,
                telegram_to: '12345',
                telegram_bot_token: 'tok',
            },
        });

        const result = await notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });

        expect(result.sent).toBe(true);
        expect(getOrCreateClient).not.toHaveBeenCalled();
        expect(deps.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('waits for ready event when WA is opted-in and still INITIALIZING', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const deps = makeDeps({
            vaultInitialized: true,
            messaging: { whatsapp_notify_on_restart: true, whatsapp_to: '972501234567' },
        });

        const promise = notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });
        // Let the function read the DB and reach the wait.
        await flushMicrotasks();
        await flushMicrotasks();
        expect(deps.sendNotification).not.toHaveBeenCalled();

        // Simulate WhatsApp finishing its session restore.
        mockClient.emit('ready');
        const result = await promise;

        expect(result.sent).toBe(true);
        expect(deps.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('still tries Telegram if WhatsApp auth fails during the wait (and TG is opted in)', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const deps = makeDeps({
            vaultInitialized: true,
            messaging: {
                whatsapp_notify_on_restart: true,
                whatsapp_to: '972501234567',
                telegram_enabled: true,
                telegram_notify_on_restart: true,
                telegram_to: '12345',
                telegram_bot_token: 'tok',
            },
        });

        const promise = notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });
        await flushMicrotasks();

        mockClient.emit('auth_failure', 'session expired');
        const result = await promise;

        // Telegram still went out via the dispatcher.
        expect(result.sent).toBe(true);
        expect(deps.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('drops the notification cleanly if WhatsApp auth fails and TG is not configured', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const deps = makeDeps({
            vaultInitialized: true,
            messaging: { whatsapp_notify_on_restart: true, whatsapp_to: '972501234567' },
        });

        const promise = notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });
        await flushMicrotasks();

        mockClient.emit('auth_failure', 'session expired');
        const result = await promise;

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('whatsapp_not_ready');
        expect(deps.sendNotification).not.toHaveBeenCalled();
    });

    it('treats wrapped_master_key set to JSON empty-string as uninitialized', async () => {
        const queryFn = vi.fn().mockResolvedValue({
            rows: [{ key: 'wrapped_master_key', value: JSON.stringify('') }],
        });
        const getDB = vi.fn().mockResolvedValue({ query: queryFn, release: vi.fn() });
        const loadMessagingSettings = vi.fn().mockResolvedValue({
            ...defaultMessagingSettings,
            whatsapp_notify_on_restart: true,
            whatsapp_to: '972501234567',
        });
        const sendNotification = vi.fn();

        const result = await notifyAppStartedWithLockedVault({
            getDB,
            loadMessagingSettings,
            sendNotification,
            getOrCreateClient,
        });
        expect(result.reason).toBe('not_initialized');
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('handles the AUTHENTICATED status as ready (not just READY)', async () => {
        (globalThis as unknown as { whatsappStatus?: string }).whatsappStatus = 'AUTHENTICATED';

        const deps = makeDeps({
            vaultInitialized: true,
            messaging: { whatsapp_notify_on_restart: true, whatsapp_to: '972501234567' },
        });

        const result = await notifyAppStartedWithLockedVault({ ...deps, getOrCreateClient });

        expect(result.sent).toBe(true);
        // Didn't need to listen for ready — short-circuited.
        expect(deps.sendNotification).toHaveBeenCalledTimes(1);
    });
});
