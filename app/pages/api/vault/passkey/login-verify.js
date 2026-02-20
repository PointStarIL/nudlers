import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getDB } from '../../db';
import crypto from 'crypto';
import { unlockVaultWithPassphrase } from '../../../../utils/vault-utils';
import logger from '../../../../utils/logger.js';
import { rateLimit } from '../../utils/rateLimit.js';

import { getRpID, getOrigin } from './utils';

const PASSKEY_ENCRYPTION_SECRET = process.env.PASSKEY_ENCRYPTION_SECRET;
const PASSKEY_SCRYPT_SALT = 'nudlers-passkey-scrypt-salt';

// Rate limit: 10 attempts per 15 minutes per IP to prevent brute-force.
const loginVerifyLimiter = rateLimit({ keyPrefix: 'passkey-login-verify', limit: 10, windowMs: 15 * 60 * 1000 });

function decryptPassphrase(encryptedData) {
    if (!PASSKEY_ENCRYPTION_SECRET) {
        throw new Error('PASSKEY_ENCRYPTION_SECRET environment variable is not set. Passkey operations are disabled.');
    }
    const [ivHex, encrypted, tagHex] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(PASSKEY_ENCRYPTION_SECRET, PASSKEY_SCRYPT_SALT, 32), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    // Rate limiting
    const limitResult = loginVerifyLimiter(req, res);
    if (!limitResult.ok) {
        return res.status(429).json({ error: limitResult.error });
    }

    const { authenticationResponse } = req.body;

    if (!authenticationResponse) {
        return res.status(400).json({ error: 'Missing authentication response' });
    }

    let db;
    try {
        db = await getDB();

        // 1. Read and immediately consume the challenge atomically.
        //    Deleting before verification prevents replay attacks: if verification
        //    fails, the challenge is already gone so it cannot be retried.
        await db.query('BEGIN');
        let expectedChallenge;
        try {
            const challengeResult = await db.query(
                "SELECT value FROM app_settings WHERE key = 'passkey_authentication_challenge'"
            );
            if (challengeResult.rows.length === 0) {
                await db.query('ROLLBACK');
                return res.status(400).json({ error: 'Authentication challenge not found or expired' });
            }
            // challenge is stored as JSON.stringify(string) — parse it back.
            try {
                expectedChallenge = JSON.parse(challengeResult.rows[0].value);
            } catch {
                expectedChallenge = challengeResult.rows[0].value;
            }
            await db.query("DELETE FROM app_settings WHERE key = 'passkey_authentication_challenge'");
            await db.query('COMMIT');
        } catch (txErr) {
            await db.query('ROLLBACK').catch(() => { });
            throw txErr;
        }

        // 2. Get the credential from DB (explicit columns to avoid accidental exposure)
        const credentialResult = await db.query(
            "SELECT id, credential_id, public_key, counter, transports, encrypted_passphrase FROM vault_passkeys WHERE credential_id = $1",
            [authenticationResponse.id]
        );
        if (credentialResult.rows.length === 0) {
            return res.status(404).json({ error: 'Credential not found' });
        }
        const dbCredential = credentialResult.rows[0];

        // 3. Verify authentication response
        const verification = await verifyAuthenticationResponse({
            response: authenticationResponse,
            expectedChallenge,
            expectedOrigin: getOrigin(req),
            expectedRPID: getRpID(req),
            credential: {
                id: dbCredential.credential_id,
                publicKey: dbCredential.public_key,
                counter: Number(dbCredential.counter),
            },
        });

        if (!verification.verified) {
            return res.status(400).json({ error: 'Passkey verification failed' });
        }

        const { authenticationInfo } = verification;
        const { newCounter } = authenticationInfo;

        // Update counter
        await db.query("UPDATE vault_passkeys SET counter = $1 WHERE credential_id = $2", [newCounter, dbCredential.credential_id]);

        // 4. Decrypt passphrase and unlock vault
        const passphrase = decryptPassphrase(dbCredential.encrypted_passphrase);
        const unlockResult = await unlockVaultWithPassphrase(passphrase);

        if (unlockResult.success) {
            logger.info('Vault unlocked via passkey');
            return res.status(200).json({ success: true, message: 'Vault unlocked via passkey' });
        } else {
            logger.error({ error: unlockResult.error }, 'Vault unlock failed after passkey verification');
            return res.status(500).json({ error: 'Passkey verified but vault unlock failed' });
        }
    } catch (error) {
        logger.error({ error: error.message }, 'Passkey authentication verification failed');
        return res.status(500).json({ error: 'Failed to verify passkey' });
    } finally {
        if (db) db.release();
    }
}
