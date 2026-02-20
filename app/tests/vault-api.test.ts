import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

vi.mock('../utils/vault-utils', () => ({
    unlockVaultWithPassphrase: vi.fn()
}));

import { getDB } from '../pages/api/db';
import { unlockVaultWithPassphrase } from '../utils/vault-utils';
import VaultStore from '../pages/api/utils/VaultStore';
import initializeHandler from '../pages/api/vault/initialize';
import unlockHandler from '../pages/api/vault/unlock';
import lockHandler from '../pages/api/vault/lock';
import statusHandler from '../pages/api/vault/status';
import changePassphraseHandler from '../pages/api/vault/change-passphrase';

describe('Vault API Routes', () => {
    let mockClient: any;
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();
        VaultStore.clear();
        delete process.env.NUDLERS_ENCRYPTION_KEY;

        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };
        (getDB as any).mockResolvedValue(mockClient);

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            end: vi.fn(),
            setHeader: vi.fn(),
        };
    });

    afterEach(() => {
        VaultStore.clear();
        vi.restoreAllMocks();
    });

    describe('POST /api/vault/initialize', () => {
        it('should reject non-POST methods', async () => {
            mockReq = { method: 'GET' };
            await initializeHandler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should reject missing passphrase', async () => {
            mockReq = { method: 'POST', body: {} };
            await initializeHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: expect.stringContaining('8 characters') })
            );
        });

        it('should reject short passphrase', async () => {
            mockReq = { method: 'POST', body: { passphrase: 'short' } };
            await initializeHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should reject if vault already initialized', async () => {
            // Query 1: BEGIN
            mockClient.query.mockResolvedValueOnce({});
            // Query 2: check returns existing key
            mockClient.query.mockResolvedValueOnce({
                rows: [{ value: '"some-wrapped-key"' }]
            });
            // Query 3: ROLLBACK (called when already initialized)
            mockClient.query.mockResolvedValueOnce({});
            mockReq = { method: 'POST', body: { passphrase: 'test-passphrase-long' } };
            await initializeHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: expect.stringContaining('already initialized') })
            );
        });

        it('should initialize vault successfully', async () => {
            // Query 1: BEGIN
            mockClient.query.mockResolvedValueOnce({});
            // Query 2: check if already initialized (empty)
            mockClient.query.mockResolvedValueOnce({ rows: [{ value: '' }] });
            // Query 3: INSERT vault_salt
            mockClient.query.mockResolvedValueOnce({});
            // Query 4: INSERT wrapped_master_key
            mockClient.query.mockResolvedValueOnce({});
            // Query 5: COMMIT
            mockClient.query.mockResolvedValueOnce({});

            mockReq = { method: 'POST', body: { passphrase: 'test-passphrase-long' } };
            await initializeHandler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
            expect(VaultStore.isLocked()).toBe(false);
        });

        it('should release database client on success', async () => {
            mockClient.query.mockResolvedValueOnce({});
            mockClient.query.mockResolvedValueOnce({ rows: [{ value: '' }] });
            mockClient.query.mockResolvedValueOnce({});
            mockClient.query.mockResolvedValueOnce({});
            mockClient.query.mockResolvedValueOnce({});

            mockReq = { method: 'POST', body: { passphrase: 'test-passphrase-long' } };
            await initializeHandler(mockReq, mockRes);

            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should release database client on error', async () => {
            mockClient.query.mockRejectedValueOnce(new Error('DB error'));

            mockReq = { method: 'POST', body: { passphrase: 'test-passphrase-long' } };
            await initializeHandler(mockReq, mockRes);

            expect(mockClient.release).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('POST /api/vault/lock', () => {
        it('should reject non-POST methods', async () => {
            mockReq = { method: 'GET' };
            await lockHandler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should lock the vault', async () => {
            const key = Buffer.alloc(32, 1);
            VaultStore.setKey(key);
            expect(VaultStore.isLocked()).toBe(false);

            mockReq = { method: 'POST' };
            await lockHandler(mockReq, mockRes);

            expect(VaultStore.isLocked()).toBe(true);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, locked: true })
            );
        });
    });

    describe('GET /api/vault/status', () => {
        it('should reject non-GET methods', async () => {
            mockReq = { method: 'POST' };
            await statusHandler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should return locked status when vault is locked', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: [{ value: '"some-key"' }] });
            mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

            mockReq = { method: 'GET' };
            await statusHandler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const jsonArg = mockRes.json.mock.calls[0][0];
            expect(jsonArg.locked).toBe(true);
            expect(jsonArg.initialized).toBe(true);
            expect(jsonArg.hasPasskeys).toBe(false);
            expect(jsonArg.passkeysCount).toBe(0);
        });

        it('should return hasPasskeys when passkeys are registered', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: [{ value: '"some-key"' }] });
            mockClient.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

            mockReq = { method: 'GET' };
            await statusHandler(mockReq, mockRes);

            const jsonArg = mockRes.json.mock.calls[0][0];
            expect(jsonArg.hasPasskeys).toBe(true);
            expect(jsonArg.passkeysCount).toBe(3);
        });

        it('should return needsMigration when legacy key exists and vault not initialized', async () => {
            process.env.NUDLERS_ENCRYPTION_KEY = 'legacy-key-hex';
            mockClient.query.mockResolvedValueOnce({ rows: [{ value: '' }] });
            mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

            mockReq = { method: 'GET' };
            await statusHandler(mockReq, mockRes);

            const jsonArg = mockRes.json.mock.calls[0][0];
            expect(jsonArg.needsMigration).toBe(true);
            expect(jsonArg.initialized).toBe(false);

            delete process.env.NUDLERS_ENCRYPTION_KEY;
        });

        it('should release database client', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: [{ value: '' }] });
            mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

            mockReq = { method: 'GET' };
            await statusHandler(mockReq, mockRes);

            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('POST /api/vault/change-passphrase', () => {
        it('should reject non-POST methods', async () => {
            mockReq = { method: 'GET' };
            await changePassphraseHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should reject when vault is locked', async () => {
            mockReq = { method: 'POST', body: { currentPassphrase: 'old', newPassphrase: 'new-passphrase' } };
            await changePassphraseHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should reject missing fields', async () => {
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockReq = { method: 'POST', body: { currentPassphrase: 'old' } };
            await changePassphraseHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should reject short new passphrase', async () => {
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockReq = { method: 'POST', body: { currentPassphrase: 'old-pass-long', newPassphrase: 'short' } };
            await changePassphraseHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should reject same passphrase', async () => {
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockReq = {
                method: 'POST',
                body: { currentPassphrase: 'same-passphrase', newPassphrase: 'same-passphrase' }
            };
            await changePassphraseHandler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });
    });
});

describe('Passkey API Routes', () => {
    let mockClient: any;
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();
        VaultStore.clear();

        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };
        (getDB as any).mockResolvedValue(mockClient);
        (unlockVaultWithPassphrase as any).mockResolvedValue({ success: true });

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            end: vi.fn(),
            setHeader: vi.fn(),
        };
    });

    afterEach(() => {
        VaultStore.clear();
        vi.restoreAllMocks();
    });

    describe('GET /api/vault/passkey (list)', () => {
        it('should list passkeys', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/index');
            mockClient.query.mockResolvedValueOnce({
                rows: [
                    { id: 1, credential_id: 'cred-1', created_at: '2024-01-01' },
                    { id: 2, credential_id: 'cred-2', created_at: '2024-01-02' },
                ]
            });

            const mockReq = { method: 'GET' };
            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const jsonArg = mockRes.json.mock.calls[0][0];
            expect(jsonArg.passkeys).toHaveLength(2);
            expect(jsonArg.total).toBe(2);
        });

        it('should reject unsupported methods', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/index');
            const mockReq = { method: 'POST' };
            await handler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'DELETE']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });
    });

    describe('DELETE /api/vault/passkey (clear all)', () => {
        it('should require unlocked vault', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/index');
            const mockReq = { method: 'DELETE' };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should clear all passkeys when vault is unlocked', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/index');
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockClient.query.mockResolvedValueOnce({ rowCount: 3 });

            const mockReq = { method: 'DELETE' };
            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, cleared: 3 })
            );
        });

        it('should release client even on error', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/index');
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockClient.query.mockRejectedValueOnce(new Error('DB fail'));

            const mockReq = { method: 'DELETE' };
            await handler(mockReq, mockRes);

            expect(mockClient.release).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('DELETE /api/vault/passkey/[id]', () => {
        it('should reject unsupported methods', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/[id]');
            const mockReq = { method: 'GET', query: { id: '1' } };
            await handler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['DELETE']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should require unlocked vault', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/[id]');
            const mockReq = { method: 'DELETE', query: { id: '1' } };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should reject invalid ID', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/[id]');
            VaultStore.setKey(Buffer.alloc(32, 1));
            const mockReq = { method: 'DELETE', query: { id: 'abc' } };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should return 404 when passkey not found', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/[id]');
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockClient.query.mockResolvedValueOnce({ rowCount: 0 });

            const mockReq = { method: 'DELETE', query: { id: '999' } };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
        });

        it('should delete passkey successfully', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/[id]');
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

            const mockReq = { method: 'DELETE', query: { id: '1' } };
            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });
    });

    describe('GET /api/vault/passkey/login-options', () => {
        it('should reject non-GET methods', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/login-options');
            const mockReq = { method: 'POST' };
            await handler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should return 404 when no passkeys registered', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/login-options');
            mockClient.query.mockResolvedValueOnce({ rows: [] });

            const mockReq = { method: 'GET' };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
        });
    });

    describe('POST /api/vault/passkey/register-verify', () => {
        const originalSecret = process.env.PASSKEY_ENCRYPTION_SECRET;

        beforeEach(() => {
            process.env.PASSKEY_ENCRYPTION_SECRET = 'test-secret-for-unit-tests-only-32b';
        });

        afterEach(() => {
            if (originalSecret === undefined) {
                delete process.env.PASSKEY_ENCRYPTION_SECRET;
            } else {
                process.env.PASSKEY_ENCRYPTION_SECRET = originalSecret;
            }
        });

        it('should reject non-POST methods', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/register-verify');
            const mockReq = { method: 'GET' };
            await handler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should require unlocked vault', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/register-verify');
            const mockReq = { method: 'POST', body: { registrationResponse: {}, passphrase: 'test' } };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should require both registrationResponse and passphrase', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/register-verify');
            VaultStore.setKey(Buffer.alloc(32, 1));
            const mockReq = { method: 'POST', body: { registrationResponse: {} } };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should reject a passphrase that does not match the vault', async () => {
            (unlockVaultWithPassphrase as any).mockResolvedValueOnce({ success: false, error: 'Invalid passphrase or corrupted master key' });
            const { default: handler } = await import('../pages/api/vault/passkey/register-verify');
            VaultStore.setKey(Buffer.alloc(32, 1));
            const mockReq = {
                method: 'POST',
                headers: { host: 'localhost' },
                body: { registrationResponse: { id: 'cred-id', response: { transports: [] } }, passphrase: 'wrong-passphrase' }
            };
            await handler(mockReq, mockRes);
            expect(unlockVaultWithPassphrase).toHaveBeenCalledWith('wrong-passphrase');
            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: expect.stringContaining('does not match') })
            );
        });

        it('should return 500 when PASSKEY_ENCRYPTION_SECRET is not set', async () => {
            delete process.env.PASSKEY_ENCRYPTION_SECRET;
            const { default: handler } = await import('../pages/api/vault/passkey/register-verify');
            VaultStore.setKey(Buffer.alloc(32, 1));
            mockClient.query.mockResolvedValueOnce({
                rows: [{ value: JSON.stringify('some-challenge') }]
            });
            const mockReq = {
                method: 'POST',
                headers: { host: 'localhost' },
                body: { registrationResponse: { id: 'cred-id', response: { transports: [] } }, passphrase: 'test-passphrase' }
            };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('POST /api/vault/passkey/login-verify', () => {
        const originalSecret = process.env.PASSKEY_ENCRYPTION_SECRET;

        beforeEach(() => {
            process.env.PASSKEY_ENCRYPTION_SECRET = 'test-secret-for-unit-tests-only-32b';
        });

        afterEach(() => {
            if (originalSecret === undefined) {
                delete process.env.PASSKEY_ENCRYPTION_SECRET;
            } else {
                process.env.PASSKEY_ENCRYPTION_SECRET = originalSecret;
            }
        });

        it('should reject non-POST methods', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/login-verify');
            const mockReq = { method: 'GET' };
            await handler(mockReq, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should reject missing authentication response', async () => {
            const { default: handler } = await import('../pages/api/vault/passkey/login-verify');
            const mockReq = { method: 'POST', body: {} };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should return 500 when PASSKEY_ENCRYPTION_SECRET is not set', async () => {
            delete process.env.PASSKEY_ENCRYPTION_SECRET;
            const { default: handler } = await import('../pages/api/vault/passkey/login-verify');
            mockClient.query
                .mockResolvedValueOnce({ rows: [{ value: JSON.stringify('some-challenge') }] })
                .mockResolvedValueOnce({ rows: [{ credential_id: 'cred-id', public_key: Buffer.alloc(32), counter: 0, encrypted_passphrase: 'iv:data:tag' }] });
            const mockReq = {
                method: 'POST',
                headers: { host: 'localhost' },
                body: { authenticationResponse: { id: 'cred-id' } }
            };
            await handler(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });
});
