import crypto from 'crypto';
import { getDB } from '../pages/api/db';
import VaultStore from '../pages/api/utils/VaultStore';
import logger from './logger.js';

// Kept only for migrating pre-existing vaults that were created before
// per-vault random salts were introduced. Never used for new vaults.
const LEGACY_SALT = 'nudlers-vault-salt';

// One-shot guard: the "notify on unlock" feature should fire at most once per
// process lifetime — only the first unlock following a restart is interesting.
// Resets naturally when the process restarts, which is the only event that
// re-locks the vault.
let unlockNotificationFired = false;

// Test seam: lets the suite reset the one-shot flag between cases.
export function _resetUnlockNotificationFlagForTests() {
    unlockNotificationFired = false;
}

/**
 * Core logic to unlock the vault with a passphrase.
 * Returns { success: boolean, error?: string }
 *
 * If the vault was created before random salts were introduced it will be
 * transparently migrated: on the first successful unlock the wrapped key is
 * re-stored with a fresh random salt so subsequent unlocks use it.
 */
export async function unlockVaultWithPassphrase(passphrase) {
    if (!passphrase) {
        return { success: false, error: 'Passphrase is required' };
    }

    let wrappedKey;
    let storedSaltHex;
    let client;

    try {
        client = await getDB();
        const result = await client.query(
            "SELECT key, value FROM app_settings WHERE key IN ('wrapped_master_key', 'vault_salt')"
        );
        for (const row of result.rows) {
            if (row.key === 'wrapped_master_key') {
                const raw = row.value;
                try { wrappedKey = JSON.parse(raw); } catch { wrappedKey = raw; }
            } else if (row.key === 'vault_salt') {
                // vault_salt is stored as JSON.stringify(hexString) — parse it back.
                try { storedSaltHex = JSON.parse(row.value); } catch { storedSaltHex = row.value; }
            }
        }
    } catch (err) {
        logger.error({ error: err.message }, "Failed to read vault key from DB");
        return { success: false, error: 'Failed to access vault configuration' };
    } finally {
        if (client) client.release();
    }

    if (!wrappedKey) {
        return { success: false, error: 'Vault is not initialized (no key found in database)' };
    }

    const isLegacy = !storedSaltHex;
    const salt = isLegacy ? Buffer.from(LEGACY_SALT) : Buffer.from(storedSaltHex, 'hex');

    let wrappingKey;
    try {
        wrappingKey = crypto.scryptSync(passphrase, salt, 32);

        const [ivHex, encryptedData, authTagHex] = wrappedKey.split(':');
        if (!ivHex || !encryptedData || !authTagHex) {
            throw new Error('Invalid wrapped key format');
        }

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, iv);
        decipher.setAuthTag(authTag);

        let decryptedMasterKey = decipher.update(encryptedData, 'hex');
        decryptedMasterKey = Buffer.concat([decryptedMasterKey, decipher.final()]);

        VaultStore.setKey(decryptedMasterKey);
        // decryptedMasterKey is intentionally not zeroed: VaultStore now owns the buffer.

        if (isLegacy) {
            // Transparently upgrade: re-wrap with a new random salt and persist it.
            migrateLegacyVault(passphrase, decryptedMasterKey).catch((migrateErr) => {
                logger.error({ error: migrateErr.message }, 'Failed to migrate vault to random salt');
            });
        }

        // Fire-and-forget WhatsApp notification on the first unlock per process,
        // if the user has opted in. Never block or fail the unlock on send errors.
        maybeNotifyUnlock().catch((notifyErr) => {
            logger.warn({ error: notifyErr.message }, 'Unlock notification failed (non-fatal)');
        });

        return { success: true };
    } catch (err) {
        logger.error({ error: err.message }, "Failed to unlock vault");
        return { success: false, error: 'Invalid passphrase or corrupted master key' };
    } finally {
        if (wrappingKey) wrappingKey.fill(0);
    }
}

/**
 * Send a WhatsApp message the first time the vault is unlocked after a process
 * start, if the user opted in via `whatsapp_notify_on_unlock`. Idempotent within
 * a process: subsequent calls are no-ops. Always reads the setting fresh so the
 * user can flip it without restarting.
 */
async function maybeNotifyUnlock() {
    if (unlockNotificationFired) return;

    let client;
    let enabled = false;
    let recipients = '';
    try {
        client = await getDB();
        const result = await client.query(
            "SELECT key, value FROM app_settings WHERE key IN ('whatsapp_notify_on_unlock', 'whatsapp_to')"
        );
        for (const row of result.rows) {
            if (row.key === 'whatsapp_notify_on_unlock') {
                try { enabled = JSON.parse(row.value) === true; } catch { enabled = row.value === 'true'; }
            } else if (row.key === 'whatsapp_to') {
                try { recipients = JSON.parse(row.value) || ''; } catch { recipients = String(row.value || '').replace(/"/g, ''); }
            }
        }
    } finally {
        if (client) client.release();
    }

    // Mark as fired even when disabled — flipping the setting on later should
    // not fire a "post-restart" notification mid-session.
    unlockNotificationFired = true;

    if (!enabled) return;
    if (!recipients) {
        logger.info('Unlock notification enabled but no whatsapp_to configured; skipping');
        return;
    }

    const now = new Date();
    const time = now.toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
    const body = `🔓 Nudlers — הכספת נפתחה\n${time}\n(אחרי הפעלה מחדש של האפליקציה)`;

    // Dynamic import so a missing/broken WhatsApp module never breaks unlock.
    const { sendWhatsAppMessage } = await import('./whatsapp.js');
    await sendWhatsAppMessage({ to: recipients, body });
    logger.info('Unlock notification sent');
}

/**
 * Re-wraps the master key with a fresh random salt and persists both to the DB.
 * Called once, lazily, the first time a legacy vault is successfully unlocked.
 */
async function migrateLegacyVault(passphrase, masterKey) {
    const newSalt = crypto.randomBytes(32);
    const newWrappingKey = crypto.scryptSync(passphrase, newSalt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', newWrappingKey, iv);
    const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const authTag = cipher.getAuthTag();
    newWrappingKey.fill(0);

    const newWrappedStr = `${iv.toString('hex')}:${wrapped.toString('hex')}:${authTag.toString('hex')}`;

    let client;
    try {
        client = await getDB();
        await client.query(
            `INSERT INTO app_settings (key, value, description)
             VALUES ('vault_salt', $1, 'Random salt for vault key derivation (scrypt)')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [JSON.stringify(newSalt.toString('hex'))]
        );
        await client.query(
            "UPDATE app_settings SET value = $1 WHERE key = 'wrapped_master_key'",
            [JSON.stringify(newWrappedStr)]
        );
        logger.info('Vault migrated to per-vault random salt');
    } finally {
        if (client) client.release();
    }
}
