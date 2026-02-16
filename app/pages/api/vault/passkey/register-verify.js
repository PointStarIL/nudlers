import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getDB } from '../../db';
import crypto from 'crypto';
import logger from '../../../../utils/logger.js';
import VaultStore from '../../utils/VaultStore';

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:6969';
const PASSKEY_ENCRYPTION_SECRET = process.env.PASSKEY_ENCRYPTION_SECRET || 'nudlers-passkey-default-secret-change-it';

function encryptPassphrase(passphrase) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(PASSKEY_ENCRYPTION_SECRET, 'salt', 32), iv);
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

    let db;
    try {
        db = await getDB();

        // 1. Get the challenge we stored
        const challengeResult = await db.query("SELECT value FROM app_settings WHERE key = 'passkey_registration_challenge'");
        if (challengeResult.rows.length === 0) {
            return res.status(400).json({ error: 'Registration challenge not found or expired' });
        }
        const expectedChallenge = challengeResult.rows[0].value;

        // 2. Verify registration response
        const verification = await verifyRegistrationResponse({
            response: registrationResponse,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
        });

        if (!verification.verified) {
            return res.status(400).json({ error: 'Passkey verification failed' });
        }

        const { registrationInfo } = verification;
        const { credential } = registrationInfo;
        const { id: credentialID, publicKey: credentialPublicKey, counter } = credential;

        // 3. Encrypt the passphrase
        const encryptedPassphrase = encryptPassphrase(passphrase);

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
                JSON.stringify(registrationResponse.response.transports || []),
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
