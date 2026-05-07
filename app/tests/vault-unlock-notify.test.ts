import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ── Mocks ──
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn(),
}));
vi.mock('../utils/whatsapp.js', () => ({
    sendWhatsAppMessage: vi.fn(),
}));
vi.mock('../utils/whatsapp-client.js', () => {
    // A minimal EventEmitter stand-in for the wwjs client. Tests can fire
    // 'ready' / 'auth_failure' on it to drive the readiness wait.
    const listeners = new Map<string, Function[]>();
    const client = {
        once: vi.fn((evt: string, cb: Function) => {
            if (!listeners.has(evt)) listeners.set(evt, []);
            listeners.get(evt)!.push(cb);
        }),
        off: vi.fn((evt: string, cb: Function) => {
            const arr = listeners.get(evt);
            if (!arr) return;
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
        }),
        emit: (evt: string, ...args: unknown[]) => {
            const arr = listeners.get(evt) || [];
            // Drain — `once` semantics mean we only fire each callback at most once.
            const snapshot = arr.slice();
            arr.length = 0;
            snapshot.forEach((cb) => cb(...args));
        },
        _reset: () => listeners.clear(),
    };
    return { getOrCreateClient: vi.fn(() => client), __mockClient: client };
});
vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { unlockVaultWithPassphrase, _resetUnlockNotificationFlagForTests } from '../utils/vault-utils';
import { getDB } from '../pages/api/db';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';
import * as whatsappClientModule from '../utils/whatsapp-client.js';
import VaultStore from '../pages/api/utils/VaultStore';

// Pull the EventEmitter-shaped stand-in we built in the mock factory.
const mockWaClient = (whatsappClientModule as unknown as { __mockClient: { emit: (evt: string, ...args: unknown[]) => void; _reset: () => void } }).__mockClient;

const PASSPHRASE = 'test-passphrase-123';

/**
 * Build a real wrapped master key + salt so unlockVaultWithPassphrase actually
 * succeeds against our mocked DB. The crypto path inside unlock isn't what
 * we're testing — we just need a successful unlock to trigger the notify hook.
 */
function buildWrappedMasterKey() {
    const masterKey = crypto.randomBytes(32);
    const salt = crypto.randomBytes(32);
    const wrappingKey = crypto.scryptSync(PASSPHRASE, salt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
    const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const wrappedStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;
    return { wrappedStr, saltHex: salt.toString('hex') };
}

function mockSettingsRows({ wrappedStr, saltHex, notifyEnabled, recipients }: {
    wrappedStr: string;
    saltHex: string;
    notifyEnabled: boolean;
    recipients: string;
}) {
    const mockClient = {
        query: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('wrapped_master_key') && sql.includes('vault_salt')) {
                return Promise.resolve({
                    rows: [
                        { key: 'wrapped_master_key', value: JSON.stringify(wrappedStr) },
                        { key: 'vault_salt', value: JSON.stringify(saltHex) },
                    ],
                });
            }
            if (sql.includes('whatsapp_notify_on_unlock') && sql.includes('whatsapp_to')) {
                return Promise.resolve({
                    rows: [
                        { key: 'whatsapp_notify_on_unlock', value: JSON.stringify(notifyEnabled) },
                        { key: 'whatsapp_to', value: JSON.stringify(recipients) },
                    ],
                });
            }
            return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
    };
    (getDB as any).mockResolvedValue(mockClient);
    return mockClient;
}

// Wait for the fire-and-forget notify promise chain to settle.
const flushMicrotasks = () => new Promise((r) => setImmediate(r));

describe('unlockVaultWithPassphrase — WhatsApp notify on unlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        VaultStore.clear();
        _resetUnlockNotificationFlagForTests();
        mockWaClient._reset();
        // Default for the existing tests: WhatsApp is already up and running,
        // so waitForWhatsAppReady() short-circuits and tests don't need to
        // emit any event to make the send happen.
        (global as unknown as { whatsappStatus?: string }).whatsappStatus = 'READY';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (global as unknown as { whatsappStatus?: string }).whatsappStatus;
    });

    it('does NOT send a WhatsApp message when the setting is disabled', async () => {
        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: false, recipients: '972501234567' });

        const result = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(result.success).toBe(true);
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('sends a WhatsApp message when enabled and recipients are configured', async () => {
        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '972501234567' });
        (sendWhatsAppMessage as any).mockResolvedValue({ success: true, sent: 1 });

        const result = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(result.success).toBe(true);
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
        const arg = (sendWhatsAppMessage as any).mock.calls[0][0];
        expect(arg.to).toBe('972501234567');
        expect(arg.body).toContain('Nudlers');
        expect(arg.body).toContain('הכספת נפתחה');
    });

    it('does NOT send when enabled but no recipients are configured', async () => {
        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '' });

        const result = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(result.success).toBe(true);
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('only fires once per process — second unlock is silent (the "after restart" semantic)', async () => {
        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '972501234567' });
        (sendWhatsAppMessage as any).mockResolvedValue({ success: true, sent: 1 });

        const r1 = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();
        const r2 = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    it('a WhatsApp send failure does NOT fail the unlock', async () => {
        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '972501234567' });
        (sendWhatsAppMessage as any).mockRejectedValue(new Error('WhatsApp client down'));

        const result = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(result.success).toBe(true);
        expect(VaultStore.isLocked()).toBe(false);
    });

    it('waits for the ready event when WhatsApp is still INITIALIZING at unlock time, then sends', async () => {
        // Reproduce the actual production race: user just restarted the app
        // and unlocked while the WhatsApp client is still loading its session.
        (global as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '972501234567' });
        (sendWhatsAppMessage as any).mockResolvedValue({ success: true, sent: 1 });

        const result = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(result.success).toBe(true);
        // Send must NOT have happened yet — we're still waiting on `ready`.
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();

        // Simulate WhatsApp finishing its session restore.
        mockWaClient.emit('ready');
        // Two flushes: one for `ready` resolving the wait, one for the awaited send.
        await flushMicrotasks();
        await flushMicrotasks();

        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    it('drops the notification (without crashing) if WhatsApp auth fails while we wait', async () => {
        (global as unknown as { whatsappStatus?: string }).whatsappStatus = 'INITIALIZING';

        const { wrappedStr, saltHex } = buildWrappedMasterKey();
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '972501234567' });

        const result = await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(result.success).toBe(true);
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();

        mockWaClient.emit('auth_failure', 'session expired');
        await flushMicrotasks();
        await flushMicrotasks();

        // Still no send — auth failure aborted the wait, and unlock survived.
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
        expect(VaultStore.isLocked()).toBe(false);
    });

    it('flipping the setting on AFTER first unlock does not retroactively fire (semantics: only first unlock since restart)', async () => {
        const { wrappedStr, saltHex } = buildWrappedMasterKey();

        // First unlock with setting OFF — the one-shot flag is consumed.
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: false, recipients: '972501234567' });
        await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();

        // User now toggles the setting ON, locks, and unlocks again — still no send,
        // because the meaningful "first unlock after restart" already happened.
        mockSettingsRows({ wrappedStr, saltHex, notifyEnabled: true, recipients: '972501234567' });
        VaultStore.clear();
        await unlockVaultWithPassphrase(PASSPHRASE);
        await flushMicrotasks();

        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });
});
