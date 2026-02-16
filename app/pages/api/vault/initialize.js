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

        // 1. Check if already initialized
        const checkResult = await client.query("SELECT value FROM app_settings WHERE key = 'wrapped_master_key'");
        const existingValue = checkResult.rows[0]?.value;

        if (existingValue && existingValue.length > 0) {
            return res.status(400).json({ error: 'Vault is already initialized. Use unlock instead.' });
        }

        // 2. Generate new master key
        const masterKey = crypto.randomBytes(32);

        // 3. Wrap it
        const salt = 'nudlers-vault-salt';
        const wrappingKey = crypto.scryptSync(passphrase, salt, 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);

        const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const wrappedStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;

        // 4. Save to DB (UPSERT)
        await client.query(
            `INSERT INTO app_settings (key, value, description)
             VALUES ('wrapped_master_key', $1, 'The master key wrapped with a passphrase for memory-locked credentials')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [JSON.stringify(wrappedStr)]
        );

        // 5. Instantly unlock it in memory
        VaultStore.setKey(masterKey);

        // 6. Wipe temporary wrapping key
        wrappingKey.fill(0);

        logger.info("Vault initialized and unlocked successfully");
        res.status(201).json({ success: true, message: 'Vault initialized' });
    } catch (err) {
        logger.error({ error: err.message }, "Failed to initialize vault");
        res.status(500).json({ error: 'Failed to initialize vault' });
    } finally {
        if (client) client.release();
    }
}
