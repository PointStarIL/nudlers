import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import VaultStore from '../pages/api/utils/VaultStore';
import { encrypt, decrypt, VaultLockedError } from '../pages/api/utils/encryption';

describe('Vault Mechanism', () => {
    const MASTER_KEY = crypto.randomBytes(32);
    const PASSPHRASE = 'correct-passphrase';
    // Each test generates its own random salt — no hardcoded constant here.
    const SALT = crypto.randomBytes(32);

    beforeEach(() => {
        VaultStore.clear();
        delete process.env.ENCRYPTION_KEY;
        delete process.env.NUDLERS_ENCRYPTION_KEY;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should be locked initially', () => {
        expect(VaultStore.isLocked()).toBe(true);
        expect(VaultStore.getKey()).toBeNull();
    });

    it('should store and retrieve the key', () => {
        VaultStore.setKey(MASTER_KEY);
        expect(VaultStore.isLocked()).toBe(false);
        expect(VaultStore.getKey()).toEqual(MASTER_KEY);
    });

    it('should throw VaultLockedError when trying to encrypt/decrypt while locked', () => {
        expect(() => encrypt('test')).toThrow(VaultLockedError);
        expect(() => decrypt('iv:data:tag')).toThrow(VaultLockedError);
    });

    it('should successfully encrypt/decrypt after unlocking', () => {
        VaultStore.setKey(MASTER_KEY);
        const text = 'Hello Vault';
        const encrypted = encrypt(text);
        expect(encrypted).not.toBe(text);
        expect(decrypt(encrypted)).toBe(text);
    });


    it('should simulate the full wrap/unwrap flow', () => {
        // 1. Wrap (simulate what initialize does — random salt stored in DB)
        const wrappingKey = crypto.scryptSync(PASSPHRASE, SALT, 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
        let wrapped = cipher.update(MASTER_KEY);
        wrapped = Buffer.concat([wrapped, cipher.final()]);
        const authTag = cipher.getAuthTag();

        const wrappedMasterKeyStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;

        // 2. Unwrap (simulate /api/vault/unlock — salt read from DB)
        const derivedWrappingKey = crypto.scryptSync(PASSPHRASE, SALT, 32);
        const [ivHex, encData, tagHex] = wrappedMasterKeyStr.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedWrappingKey, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let unwrapped = decipher.update(Buffer.from(encData, 'hex'));
        unwrapped = Buffer.concat([unwrapped, decipher.final()]);

        VaultStore.setKey(unwrapped);

        // 3. Verify
        expect(unwrapped).toEqual(MASTER_KEY);
        expect(decrypt(encrypt('Final Test'))).toBe('Final Test');
    });

    describe('Change Passphrase (re-wrap)', () => {
        const NEW_PASSPHRASE = 'new-strong-passphrase';

        function wrapKey(masterKey: Buffer, passphrase: string, salt: Buffer): string {
            const wrappingKey = crypto.scryptSync(passphrase, salt, 32);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
            const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
            const authTag = cipher.getAuthTag();
            wrappingKey.fill(0);
            return `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;
        }

        function unwrapKey(wrappedStr: string, passphrase: string, salt: Buffer): Buffer {
            const wrappingKey = crypto.scryptSync(passphrase, salt, 32);
            const [ivHex, encData, tagHex] = wrappedStr.split(':');
            const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, Buffer.from(ivHex, 'hex'));
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            let unwrapped = decipher.update(Buffer.from(encData, 'hex'));
            unwrapped = Buffer.concat([unwrapped, decipher.final()]);
            wrappingKey.fill(0);
            return unwrapped;
        }

        it('should re-wrap master key with new passphrase', () => {
            const salt1 = crypto.randomBytes(32);
            const salt2 = crypto.randomBytes(32);

            // 1. Wrap with old passphrase
            const wrappedOld = wrapKey(MASTER_KEY, PASSPHRASE, salt1);

            // 2. Unwrap with old passphrase
            const masterKey = unwrapKey(wrappedOld, PASSPHRASE, salt1);
            expect(masterKey).toEqual(MASTER_KEY);

            // 3. Re-wrap with new passphrase and new salt
            const wrappedNew = wrapKey(masterKey, NEW_PASSPHRASE, salt2);

            // 4. Verify new passphrase + new salt can unwrap
            const unwrappedNew = unwrapKey(wrappedNew, NEW_PASSPHRASE, salt2);
            expect(unwrappedNew).toEqual(MASTER_KEY);

            // 5. Verify old passphrase fails on new wrap
            expect(() => unwrapKey(wrappedNew, PASSPHRASE, salt2)).toThrow();
        });

        it('should preserve encrypt/decrypt after re-wrap', () => {
            const salt1 = crypto.randomBytes(32);
            const salt2 = crypto.randomBytes(32);

            // 1. Wrap, encrypt data, then re-wrap
            const wrappedOld = wrapKey(MASTER_KEY, PASSPHRASE, salt1);
            VaultStore.setKey(unwrapKey(wrappedOld, PASSPHRASE, salt1));
            const encrypted = encrypt('sensitive data');

            // 2. Re-wrap (simulate passphrase change)
            const masterKey = unwrapKey(wrappedOld, PASSPHRASE, salt1);
            const wrappedNew = wrapKey(masterKey, NEW_PASSPHRASE, salt2);

            // 3. Unlock with new passphrase
            VaultStore.clear();
            VaultStore.setKey(unwrapKey(wrappedNew, NEW_PASSPHRASE, salt2));

            // 4. Data encrypted before re-wrap is still decryptable (same master key)
            expect(decrypt(encrypted)).toBe('sensitive data');
        });

        it('should reject wrong current passphrase', () => {
            const salt = crypto.randomBytes(32);
            const wrappedOld = wrapKey(MASTER_KEY, PASSPHRASE, salt);
            expect(() => unwrapKey(wrappedOld, 'wrong-passphrase', salt)).toThrow();
        });
    });
});

