import crypto from 'crypto';
import { getDB } from '../db';
import VaultStore from '../utils/VaultStore';
import logger from '../../../utils/logger.js';

// Used only when no vault_salt row exists (legacy vault created before random
// salts were introduced). New vaults always have vault_salt in the DB.
const LEGACY_SALT = 'nudlers-vault-salt';

/**
 * Unwrap the master key using a passphrase and the vault's stored salt.
 * Returns the decrypted master key Buffer or throws on failure.
 */
function unwrapMasterKey(wrappedKeyStr, passphrase, salt) {
    const wrappingKey = crypto.scryptSync(passphrase, salt, 32);

    const [ivHex, encryptedData, authTagHex] = wrappedKeyStr.split(':');
    if (!ivHex || !encryptedData || !authTagHex) {
        wrappingKey.fill(0);
        throw new Error('Invalid wrapped key format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted;
    try {
        decrypted = decipher.update(encryptedData, 'hex');
        decrypted = Buffer.concat([decrypted, decipher.final()]);
    } finally {
        wrappingKey.fill(0);
    }
    return decrypted;
}

/**
 * Wrap the master key with a new passphrase and a fresh random salt.
 * Returns { wrappedStr, saltHex } — the caller must persist both to the DB.
 */
function wrapMasterKey(masterKey, passphrase) {
    const newSalt = crypto.randomBytes(32);
    const wrappingKey = crypto.scryptSync(passphrase, newSalt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);

    const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    wrappingKey.fill(0);
    return {
        wrappedStr: `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`,
        saltHex: newSalt.toString('hex'),
    };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    if (VaultStore.isLocked()) {
        return res.status(403).json({ error: 'Vault must be unlocked to change passphrase' });
    }

    const { currentPassphrase, newPassphrase } = req.body;

    if (!currentPassphrase || !newPassphrase) {
        return res.status(400).json({ error: 'Both current and new passphrase are required' });
    }

    if (newPassphrase.length < 8) {
        return res.status(400).json({ error: 'New passphrase must be at least 8 characters long' });
    }

    if (currentPassphrase === newPassphrase) {
        return res.status(400).json({ error: 'New passphrase must be different from the current one' });
    }

    let client;
    try {
        client = await getDB();

        // 1. Get the current wrapped master key and salt
        const result = await client.query(
            "SELECT key, value FROM app_settings WHERE key IN ('wrapped_master_key', 'vault_salt')"
        );
        let dbKey, storedSaltHex;
        for (const row of result.rows) {
            if (row.key === 'wrapped_master_key') dbKey = row.value;
            else if (row.key === 'vault_salt') {
                // vault_salt is stored as JSON.stringify(hexString) — parse it back.
                try { storedSaltHex = JSON.parse(row.value); } catch { storedSaltHex = row.value; }
            }
        }

        if (!dbKey) {
            return res.status(400).json({ error: 'Vault is not initialized' });
        }

        let wrappedKeyStr;
        try {
            wrappedKeyStr = JSON.parse(dbKey);
        } catch {
            wrappedKeyStr = dbKey;
        }

        // Legacy vaults have no vault_salt row — fall back to the old hardcoded salt.
        const currentSalt = storedSaltHex
            ? Buffer.from(storedSaltHex, 'hex')
            : Buffer.from(LEGACY_SALT);

        // 2. Verify current passphrase by unwrapping
        let masterKey;
        try {
            masterKey = unwrapMasterKey(wrappedKeyStr, currentPassphrase, currentSalt);
        } catch {
            return res.status(401).json({ error: 'Current passphrase is incorrect' });
        }

        // 3. Re-wrap with new passphrase and a fresh random salt (rotate salt on change)
        const { wrappedStr: newWrappedStr, saltHex: newSaltHex } = wrapMasterKey(masterKey, newPassphrase);
        masterKey.fill(0);

        // 4. Save new salt and wrapped key atomically — a crash between the two writes
        //    would leave an inconsistent vault, so wrap both in a transaction.
        await client.query('BEGIN');
        try {
            await client.query(
                `INSERT INTO app_settings (key, value, description)
                 VALUES ('vault_salt', $1, 'Random salt for vault key derivation (scrypt)')
                 ON CONFLICT (key) DO UPDATE SET value = $1`,
                [JSON.stringify(newSaltHex)]
            );
            await client.query(
                "UPDATE app_settings SET value = $1 WHERE key = 'wrapped_master_key'",
                [JSON.stringify(newWrappedStr)]
            );

            // 5. Delete all passkeys (they store encrypted copies of the old passphrase)
            const passkeysResult = await client.query('DELETE FROM vault_passkeys');
            const passkeysCleared = passkeysResult.rowCount || 0;

            await client.query('COMMIT');

            logger.info({ passkeysCleared }, 'Passphrase changed successfully, passkeys invalidated');

            res.status(200).json({
                success: true,
                message: 'Passphrase changed successfully',
                passkeysCleared
            });
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => { });
            throw txErr;
        }
    } catch (err) {
        logger.error({ error: err.message }, 'Failed to change passphrase');
        res.status(500).json({ error: 'Failed to change passphrase' });
    } finally {
        if (client) client.release();
    }
}
