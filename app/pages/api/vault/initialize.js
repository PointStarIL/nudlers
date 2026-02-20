import crypto from 'crypto';
import { getDB } from '../db';
import VaultStore from '../utils/VaultStore';
import logger from '../../../utils/logger.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const { passphrase } = req.body;
    if (!passphrase || passphrase.length < 8) {
        return res.status(400).json({ error: 'Passphrase must be at least 8 characters long' });
    }

    let client;
    try {
        client = await getDB();

        // Perform the initialization check and all writes atomically to prevent
        // a TOCTOU race where two concurrent requests both pass the check and
        // create separate master keys (one silently overwriting the other).
        await client.query('BEGIN');
        try {
            // 1. Check if already initialized (inside transaction for atomicity)
            const checkResult = await client.query("SELECT value FROM app_settings WHERE key = 'wrapped_master_key'");
            const existingValue = checkResult.rows[0]?.value ?? '';

            // Treat empty string and JSON-encoded empty string as "not initialized".
            let isInitialized = false;
            if (existingValue.length > 0) {
                try {
                    const parsed = JSON.parse(existingValue);
                    isInitialized = typeof parsed === 'string' && parsed.length > 0;
                } catch {
                    isInitialized = true; // Non-JSON non-empty means a real key is stored
                }
            }

            if (isInitialized) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Vault is already initialized. Use unlock instead.' });
            }

            // 2. Generate new master key
            const masterKey = crypto.randomBytes(32);

            // 3. Generate a unique random salt and wrap the master key
            const salt = crypto.randomBytes(32);
            const wrappingKey = crypto.scryptSync(passphrase, salt, 32);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);

            const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
            const authTag = cipher.getAuthTag();

            const wrappedStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;

            // 4. Save salt and wrapped key to DB atomically
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

            // 5. Instantly unlock it in memory
            VaultStore.setKey(masterKey);
            // masterKey is intentionally not zeroed: VaultStore now owns the buffer.

            // 6. Wipe temporary wrapping key
            wrappingKey.fill(0);

            logger.info("Vault initialized and unlocked successfully");
            res.status(201).json({ success: true, message: 'Vault initialized' });
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => { });
            throw txErr;
        }
    } catch (err) {
        logger.error({ error: err.message }, "Failed to initialize vault");
        res.status(500).json({ error: 'Failed to initialize vault' });
    } finally {
        if (client) client.release();
    }
}
