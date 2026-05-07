import crypto from 'crypto';
import { getDB } from '../pages/api/db';
import VaultStore from '../pages/api/utils/VaultStore';
import logger from './logger.js';

// Kept only for migrating pre-existing vaults that were created before
// per-vault random salts were introduced. Never used for new vaults.
const LEGACY_SALT = 'nudlers-vault-salt';

/**
 * Core logic to unlock the vault with a passphrase.
 * Returns { success: boolean, error?: string }
 *
 * If the vault was created before random salts were introduced it will be
 * transparently migrated: on the first successful unlock the wrapped key is
 * re-stored with a fresh random salt so subsequent unlocks use it.
 */
export async function unlockVaultWithPassphrase(passphrase) {
    if (!passphrase) {
        return { success: false, error: 'Passphrase is required' };
    }

    let wrappedKey;
    let storedSaltHex;
    let client;

    try {
        client = await getDB();
        const result = await client.query(
            "SELECT key, value FROM app_settings WHERE key IN ('wrapped_master_key', 'vault_salt')"
        );
        for (const row of result.rows) {
            if (row.key === 'wrapped_master_key') {
                const raw = row.value;
                try { wrappedKey = JSON.parse(raw); } catch { wrappedKey = raw; }
            } else if (row.key === 'vault_salt') {
                // vault_salt is stored as JSON.stringify(hexString) — parse it back.
                try { storedSaltHex = JSON.parse(row.value); } catch { storedSaltHex = row.value; }
            }
        }
    } catch (err) {
        logger.error({ error: err.message }, "Failed to read vault key from DB");
        return { success: false, error: 'Failed to access vault configuration' };
    } finally {
        if (client) client.release();
    }

    if (!wrappedKey) {
        return { success: false, error: 'Vault is not initialized (no key found in database)' };
    }

    const isLegacy = !storedSaltHex;
    const salt = isLegacy ? Buffer.from(LEGACY_SALT) : Buffer.from(storedSaltHex, 'hex');

    let wrappingKey;
    try {
        wrappingKey = crypto.scryptSync(passphrase, salt, 32);

        const [ivHex, encryptedData, authTagHex] = wrappedKey.split(':');
        if (!ivHex || !encryptedData || !authTagHex) {
            throw new Error('Invalid wrapped key format');
        }

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, iv);
        decipher.setAuthTag(authTag);

        let decryptedMasterKey = decipher.update(encryptedData, 'hex');
        decryptedMasterKey = Buffer.concat([decryptedMasterKey, decipher.final()]);

        VaultStore.setKey(decryptedMasterKey);
        // decryptedMasterKey is intentionally not zeroed: VaultStore now owns the buffer.

        if (isLegacy) {
            // Transparently upgrade: re-wrap with a new random salt and persist it.
            migrateLegacyVault(passphrase, decryptedMasterKey).catch((migrateErr) => {
                logger.error({ error: migrateErr.message }, 'Failed to migrate vault to random salt');
            });
        }

        return { success: true };
    } catch (err) {
        logger.error({ error: err.message }, "Failed to unlock vault");
        return { success: false, error: 'Invalid passphrase or corrupted master key' };
    } finally {
        if (wrappingKey) wrappingKey.fill(0);
    }
}

/**
 * Re-wraps the master key with a fresh random salt and persists both to the DB.
 * Called once, lazily, the first time a legacy vault is successfully unlocked.
 */
async function migrateLegacyVault(passphrase, masterKey) {
    const newSalt = crypto.randomBytes(32);
    const newWrappingKey = crypto.scryptSync(passphrase, newSalt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', newWrappingKey, iv);
    const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const authTag = cipher.getAuthTag();
    newWrappingKey.fill(0);

    const newWrappedStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;

    let client;
    try {
        client = await getDB();
        await client.query(
            `INSERT INTO app_settings (key, value, description)
             VALUES ('vault_salt', $1, 'Random salt for vault key derivation (scrypt)')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [JSON.stringify(newSalt.toString('hex'))]
        );
        await client.query(
            "UPDATE app_settings SET value = $1 WHERE key = 'wrapped_master_key'",
            [JSON.stringify(newWrappedStr)]
        );
        logger.info('Vault migrated to per-vault random salt');
    } finally {
        if (client) client.release();
    }
}
