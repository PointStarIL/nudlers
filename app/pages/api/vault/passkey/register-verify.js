import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getDB } from '../../db';
import crypto from 'crypto';
import logger from '../../../../utils/logger.js';
import VaultStore from '../../utils/VaultStore';
import { unlockVaultWithPassphrase } from '../../../../utils/vault-utils';

import { getRpID, getOrigin } from './utils';

const PASSKEY_ENCRYPTION_SECRET = process.env.PASSKEY_ENCRYPTION_SECRET;
const PASSKEY_SCRYPT_SALT = 'nudlers-passkey-scrypt-salt';

function encryptPassphrase(passphrase) {
    if (!PASSKEY_ENCRYPTION_SECRET) {
        throw new Error('PASSKEY_ENCRYPTION_SECRET environment variable is not set. Passkey operations are disabled.');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(PASSKEY_ENCRYPTION_SECRET, PASSKEY_SCRYPT_SALT, 32), iv);
    let encrypted = cipher.update(passphrase, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${encrypted}:${tag}`;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    if (VaultStore.isLocked()) {
        return res.status(403).json({ error: 'Vault must be unlocked to register passkeys' });
    }

    const { registrationResponse, passphrase } = req.body;

    if (!registrationResponse || !passphrase) {
        return res.status(400).json({ error: 'Missing required fields: registrationResponse and passphrase' });
    }

    // Verify the supplied passphrase is correct for this vault before storing it.
    // This prevents an attacker from registering a passkey tied to a passphrase
    // of their choosing while the vault happens to be unlocked.
    const passphraseCheck = await unlockVaultWithPassphrase(passphrase);
    if (!passphraseCheck.success) {
        return res.status(401).json({ error: 'Passphrase does not match the current vault' });
    }

    let db;
    try {
        db = await getDB();

        // 1. Get the challenge we stored
        const challengeResult = await db.query("SELECT value FROM app_settings WHERE key = 'passkey_registration_challenge'");
        if (challengeResult.rows.length === 0) {
            return res.status(400).json({ error: 'Registration challenge not found or expired' });
        }
        // challenge is stored as JSON.stringify(string) — parse it back.
        let expectedChallenge;
        try {
            expectedChallenge = JSON.parse(challengeResult.rows[0].value);
        } catch {
            expectedChallenge = challengeResult.rows[0].value;
        }

        // 2. Verify registration response
        const verification = await verifyRegistrationResponse({
            response: registrationResponse,
            expectedChallenge,
            expectedOrigin: getOrigin(req),
            expectedRPID: getRpID(req),
        });

        if (!verification.verified) {
            return res.status(400).json({ error: 'Passkey verification failed' });
        }

        const { registrationInfo } = verification;
        const { credential } = registrationInfo;
        const { id: credentialID, publicKey: credentialPublicKey, counter } = credential;

        // 3. Encrypt the passphrase
        const encryptedPassphrase = encryptPassphrase(passphrase);

        // Validate transports before use
        const transports = Array.isArray(registrationResponse?.response?.transports)
            ? registrationResponse.response.transports
            : [];

        // 4. Store the credential and cleanup challenge in a transaction
        await db.query('BEGIN');
        try {
            await db.query(`
                INSERT INTO vault_passkeys (credential_id, public_key, counter, transports, encrypted_passphrase)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                registrationResponse.id,
                Buffer.from(credentialPublicKey),
                counter,
                JSON.stringify(transports),
                encryptedPassphrase
            ]);

            await db.query("DELETE FROM app_settings WHERE key = 'passkey_registration_challenge'");
            await db.query('COMMIT');
        } catch (txErr) {
            await db.query('ROLLBACK').catch(() => { });
            throw txErr;
        }

        logger.info('Passkey registered successfully');
        return res.status(201).json({ success: true, message: 'Passkey registered successfully' });
    } catch (error) {
        logger.error({ error: error.message }, 'Passkey registration verification failed');
        return res.status(500).json({ error: 'Failed to register passkey' });
    } finally {
        if (db) db.release();
    }
}
