import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getDB } from '../../db';
import VaultStore from '../../utils/VaultStore';
import logger from '../../../../utils/logger.js';

import { getRpID } from './utils';

const rpName = 'Nudlers Finance';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    // Require the vault to be unlocked before issuing a registration challenge.
    // This prevents unauthenticated callers from triggering scrypt work and from
    // overwriting an in-progress legitimate registration challenge.
    if (VaultStore.isLocked()) {
        return res.status(403).json({ error: 'Vault must be unlocked to register passkeys' });
    }

    let db;
    try {
        const options = await generateRegistrationOptions({
            rpName,
            rpID: getRpID(req),
            userID: Buffer.from('user'),
            userName: 'user@nudlers.finance',
            attestationType: 'none',
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
        });

        db = await getDB();
        await db.query(`
      INSERT INTO app_settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
    `, ['passkey_registration_challenge', JSON.stringify(options.challenge), 'Temporary challenge for passkey registration']);

        return res.status(200).json(options);
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to generate registration options');
        return res.status(500).json({ error: 'Failed to generate registration options' });
    } finally {
        if (db) db.release();
    }
}
