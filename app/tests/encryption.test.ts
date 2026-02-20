import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import VaultStore from '../pages/api/utils/VaultStore';
import { encrypt, decrypt, encryptWithKey, decryptWithKey, getLegacyKey, VaultLockedError } from '../pages/api/utils/encryption';

describe('Encryption Utility Security', () => {
    // Set a valid 32-byte key for testing
    const MOCK_KEY = Buffer.alloc(32, 'a');

    beforeEach(() => {
        VaultStore.setKey(MOCK_KEY);
        delete process.env.NUDLERS_ENCRYPTION_KEY;
        delete process.env.ENCRYPTION_KEY;
    });

    afterEach(() => {
        VaultStore.clear();
        delete process.env.NUDLERS_ENCRYPTION_KEY;
        delete process.env.ENCRYPTION_KEY;
    });

    const testData = 'SensitivePassword123!';

    it('should encrypt and decrypt data correctly', () => {
        const encrypted = encrypt(testData);
        expect(encrypted).not.toBe(testData);
        expect(encrypted.split(':')).toHaveLength(3); // iv:encrypted:tag

        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(testData);
    });

    it('should produce different ciphertexts for the same plaintext (due to random IV)', () => {
        const encrypted1 = encrypt(testData);
        const encrypted2 = encrypt(testData);
        expect(encrypted1).not.toBe(encrypted2);
    });

    it('should fail to decrypt if the authentication tag is tampered with', () => {
        const encrypted = encrypt(testData);
        const parts = encrypted.split(':');
        // Modify the auth tag (last part)
        parts[2] = parts[2].substring(0, parts[2].length - 2) + '00';
        const tampered = parts.join(':');

        expect(() => decrypt(tampered)).toThrow();
    });

    it('should fail to decrypt if the encrypted data is tampered with', () => {
        const encrypted = encrypt(testData);
        const parts = encrypted.split(':');
        // Modify the encrypted data (middle part)
        parts[1] = parts[1].substring(0, parts[1].length - 2) + '00';
        const tampered = parts.join(':');

        expect(() => decrypt(tampered)).toThrow();
    });

    it('should fail to decrypt if a different key is used', () => {
        const encrypted = encrypt(testData);

        const WRONG_KEY = 'f'.repeat(64);
        const WRONG_KEY_BUFFER = Buffer.from(WRONG_KEY, 'hex');
        const ALGORITHM = 'aes-256-gcm';

        const [ivHex, encryptedData, authTagHex] = encrypted.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        expect(() => {
            const decipher = crypto.createDecipheriv(ALGORITHM, WRONG_KEY_BUFFER, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
        }).toThrow();
    });

    it('should fall back to legacy env var when VaultStore is empty', () => {
        VaultStore.clear();
        const legacyKey = crypto.randomBytes(32);
        process.env.NUDLERS_ENCRYPTION_KEY = legacyKey.toString('hex');

        const encrypted = encrypt(testData);
        expect(encrypted).not.toBe(testData);
        expect(decrypt(encrypted)).toBe(testData);
    });

    it('should throw VaultLockedError when no key source is available', () => {
        VaultStore.clear();
        expect(() => encrypt(testData)).toThrow(VaultLockedError);
    });

    it('should NOT fall back to legacy key when Vault is initialized but locked', () => {
        VaultStore.clear();
        VaultStore.setInitialized(true);
        const legacyKey = crypto.randomBytes(32);
        process.env.NUDLERS_ENCRYPTION_KEY = legacyKey.toString('hex');

        // Should throw VaultLockedError instead of using legacy key
        expect(() => encrypt(testData)).toThrow(VaultLockedError);
        expect(() => decrypt('any:data:here')).toThrow(VaultLockedError);
    });

    it('should decrypt with legacy key data encrypted with encryptWithKey', () => {
        const legacyKey = crypto.randomBytes(32);
        const newKey = crypto.randomBytes(32);

        // Simulate migration: encrypt with legacy, decrypt with legacy, re-encrypt with new
        const encryptedWithLegacy = encryptWithKey(testData, legacyKey);
        const plaintext = decryptWithKey(encryptedWithLegacy, legacyKey);
        expect(plaintext).toBe(testData);

        const reEncrypted = encryptWithKey(plaintext, newKey);
        const finalPlaintext = decryptWithKey(reEncrypted, newKey);
        expect(finalPlaintext).toBe(testData);

        // Verify cross-key decryption fails
        expect(() => decryptWithKey(reEncrypted, legacyKey)).toThrow();
    });

    it('should detect legacy key from env', () => {
        expect(getLegacyKey()).toBeNull();

        const key = crypto.randomBytes(32);
        process.env.NUDLERS_ENCRYPTION_KEY = key.toString('hex');
        const legacyKey = getLegacyKey();
        expect(legacyKey).not.toBeNull();
        expect(legacyKey).toEqual(key);
    });
});
