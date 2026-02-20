import { getDB } from "../db";
import VaultStore from "../utils/VaultStore";
import { getLegacyKey } from "../utils/encryption";
import logger from "../../../utils/logger.js";

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');

    let client;
    try {
        client = await getDB();
        const result = await client.query("SELECT value FROM app_settings WHERE key = 'wrapped_master_key'");

        const dbKey = result.rows[0]?.value ?? '';
        let isInitialized = false;
        if (typeof dbKey === 'string' && dbKey.length > 0) {
            try {
                const parsed = JSON.parse(dbKey);
                isInitialized = (typeof parsed === 'string' && parsed.length > 0);
            } catch (e) {
                isInitialized = (dbKey.length > 0);
            }
        }

        // Update VaultStore state
        VaultStore.setInitialized(isInitialized);

        const hasLegacyKey = getLegacyKey() !== null;

        // Check passkey count
        let passkeysCount = 0;
        try {
            const passkeyResult = await client.query('SELECT COUNT(*) FROM vault_passkeys');
            passkeysCount = parseInt(passkeyResult.rows[0].count, 10);
        } catch (e) {
            // Table might not exist yet before migration 008 runs
            logger.debug({ error: e.message }, 'vault_passkeys table not yet available');
        }

        res.status(200).json({
            locked: VaultStore.isLocked(),
            initialized: isInitialized,
            needsMigration: hasLegacyKey && !isInitialized,
            hasPasskeys: passkeysCount > 0,
            passkeysCount,
        });
    } catch (err) {
        logger.error({ error: err.message }, 'Failed to check vault status');
        res.status(500).json({ error: 'Failed to check vault status' });
    } finally {
        if (client) client.release();
    }
}
