import crypto from 'crypto';
import { getDB } from '../db';
import VaultStore from '../utils/VaultStore';
import { getLegacyKey, decryptWithKey, encryptWithKey } from '../utils/encryption';
import logger from '../../../utils/logger.js';

const ENCRYPTED_FIELDS = ['username', 'password', 'id_number', 'card6_digits'];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const { passphrase } = req.body;
    if (!passphrase || passphrase.length < 8) {
        return res.status(400).json({ error: 'Passphrase must be at least 8 characters long' });
    }

    // 1. Verify legacy key exists
    const legacyKey = getLegacyKey();
    if (!legacyKey) {
        return res.status(400).json({ error: 'No legacy encryption key found in environment. Migration is not needed.' });
    }

    const client = await getDB();

    try {
        // 2. Check vault isn't already initialized
        const checkResult = await client.query("SELECT value FROM app_settings WHERE key = 'wrapped_master_key'");
        const existingValue = checkResult.rows[0]?.value ?? '';
        let isInitialized = false;
        if (existingValue.length > 0) {
            try {
                const parsed = JSON.parse(existingValue);
                isInitialized = typeof parsed === 'string' && parsed.length > 0;
            } catch {
                isInitialized = true;
            }
        }
        if (isInitialized) {
            client.release();
            return res.status(400).json({ error: 'Vault is already initialized. Migration is not needed.' });
        }

        // 3. Generate new master key
        const masterKey = crypto.randomBytes(32);

        // 4. Wrap the new master key with a fresh random salt (not the legacy hardcoded salt)
        const salt = crypto.randomBytes(32);
        const wrappingKey = crypto.scryptSync(passphrase, salt, 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
        const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const wrappedStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;

        // 5. Load all credentials
        const credsResult = await client.query('SELECT id, username, password, id_number, card6_digits FROM vendor_credentials');
        const rows = credsResult.rows;

        // 6. Re-encrypt in a single transaction — also persist the random salt
        await client.query('BEGIN');

        let migratedCount = 0;

        for (const row of rows) {
            const updates = {};
            let hasUpdate = false;

            for (const field of ENCRYPTED_FIELDS) {
                if (row[field]) {
                    try {
                        const plaintext = decryptWithKey(row[field], legacyKey);
                        updates[field] = encryptWithKey(plaintext, masterKey);
                        hasUpdate = true;
                    } catch (err) {
                        logger.warn({ credentialId: row.id, field, error: err.message }, 'Skipping field - could not decrypt with legacy key');
                        // Leave this field as-is if it can't be decrypted
                    }
                }
            }

            if (hasUpdate) {
                const setClauses = [];
                const params = [];
                let paramIdx = 1;

                for (const [field, value] of Object.entries(updates)) {
                    setClauses.push(`${field} = $${paramIdx}`);
                    params.push(value);
                    paramIdx++;
                }

                params.push(row.id);
                await client.query(
                    `UPDATE vendor_credentials SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
                    params
                );
                migratedCount++;
            }
        }

        // 7. Store vault_salt and wrapped master key (UPSERT)
        await client.query(
            `INSERT INTO app_settings (key, value, description)
             VALUES ('vault_salt', $1, 'Random salt for vault key derivation (scrypt)')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [JSON.stringify(salt.toString('hex'))]
        );
        await client.query(
            `INSERT INTO app_settings (key, value, description)
             VALUES ('wrapped_master_key', $1, 'The master key wrapped with a passphrase for memory-locked credentials')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [JSON.stringify(wrappedStr)]
        );

        await client.query('COMMIT');

        // 8. Set new key in VaultStore (auto-unlock) and wipe wrapping key
        VaultStore.setKey(masterKey);
        // masterKey is intentionally not zeroed: VaultStore now owns the buffer.
        wrappingKey.fill(0);

        logger.info({ migratedCount, totalCredentials: rows.length }, 'Vault migration completed successfully');
        res.status(200).json({
            success: true,
            message: 'Migration complete. You can now remove NUDLERS_ENCRYPTION_KEY from your environment.',
            migratedCount
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        logger.error({ error: err.message, stack: err.stack }, 'Vault migration failed');
        res.status(500).json({ error: 'Migration failed. No data was changed.' });
    } finally {
        client.release();
    }
}
