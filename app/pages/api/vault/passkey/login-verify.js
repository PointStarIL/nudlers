import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getDB } from '../../db';
import crypto from 'crypto';
import { unlockVaultWithPassphrase } from '../../../../utils/vault-utils';
import logger from '../../../../utils/logger.js';

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:6969';
const PASSKEY_ENCRYPTION_SECRET = process.env.PASSKEY_ENCRYPTION_SECRET || 'nudlers-passkey-default-secret-change-it';

function decryptPassphrase(encryptedData) {
    const [ivHex, encrypted, tagHex] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(PASSKEY_ENCRYPTION_SECRET, 'salt', 32), iv);
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

    const { authenticationResponse } = req.body;

    if (!authenticationResponse) {
        return res.status(400).json({ error: 'Missing authentication response' });
    }

    let db;
    try {
        db = await getDB();

        // 1. Get the challenge
        const challengeResult = await db.query("SELECT value FROM app_settings WHERE key = 'passkey_authentication_challenge'");
        if (challengeResult.rows.length === 0) {
            return res.status(400).json({ error: 'Authentication challenge not found or expired' });
        }
        const expectedChallenge = challengeResult.rows[0].value;

        // 2. Get the credential from DB
        const credentialResult = await db.query("SELECT * FROM vault_passkeys WHERE credential_id = $1", [authenticationResponse.id]);
        if (credentialResult.rows.length === 0) {
            return res.status(404).json({ error: 'Credential not found' });
        }
        const dbCredential = credentialResult.rows[0];

        // 3. Verify authentication response
        const verification = await verifyAuthenticationResponse({
            response: authenticationResponse,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
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

        // 4. Decrypt passphrase
        const passphrase = decryptPassphrase(dbCredential.encrypted_passphrase);

        // 5. Unlock vault
        const unlockResult = await unlockVaultWithPassphrase(passphrase);

        // Cleanup challenge
        await db.query("DELETE FROM app_settings WHERE key = 'passkey_authentication_challenge'");

        if (unlockResult.success) {
            logger.info('Vault unlocked via passkey');
            return res.status(200).json({ success: true, message: 'Vault unlocked via passkey' });
        } else {
            return res.status(401).json({ error: unlockResult.error });
        }
    } catch (error) {
        logger.error({ error: error.message }, 'Passkey authentication verification failed');
        return res.status(500).json({ error: 'Failed to verify passkey' });
    } finally {
        if (db) db.release();
    }
}
