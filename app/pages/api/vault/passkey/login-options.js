import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getDB } from '../../db';
import logger from '../../../../utils/logger.js';

import { getRpID } from './utils';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    let db;
    try {
        db = await getDB();

        // Get all registered credentials
        const credentialsResult = await db.query("SELECT credential_id, transports FROM vault_passkeys");

        if (credentialsResult.rows.length === 0) {
            return res.status(404).json({ error: 'No passkeys registered' });
        }

        const options = await generateAuthenticationOptions({
            rpID: getRpID(req),
            allowCredentials: credentialsResult.rows.map(row => ({
                id: row.credential_id,
                transports: typeof row.transports === 'string' ? JSON.parse(row.transports) : (row.transports || []),
            })),
            userVerification: 'preferred',
        });

        // Store challenge for verification
        await db.query(`
      INSERT INTO app_settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
    `, ['passkey_authentication_challenge', JSON.stringify(options.challenge), 'Temporary challenge for passkey authentication']);

        return res.status(200).json(options);
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to generate authentication options');
        return res.status(500).json({ error: 'Failed to generate authentication options' });
    } finally {
        if (db) db.release();
    }
}
