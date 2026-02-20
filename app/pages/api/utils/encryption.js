import crypto from 'crypto';
import VaultStore from './VaultStore';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked. Please unlock the vault with your passphrase.');
    this.name = 'VaultLockedError';
    this.status = 401;
  }
}

/**
 * Returns the legacy encryption key from env vars, or null if not set.
 */
export function getLegacyKey() {
  const hex = process.env.NUDLERS_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  return Buffer.from(hex, 'hex');
}

function getEncryptionKey() {
  // 1. Get key from memory (VaultStore)
  const memoryKey = VaultStore.getKey();
  if (memoryKey) {
    return memoryKey;
  }

  // 2. If vault is initialized but locked, throw VaultLockedError (no fallback to legacy)
  if (VaultStore.isInitialized()) {
    throw new VaultLockedError();
  }

  // 3. If NOT initialized, fall back to legacy env var (backward compat)
  const legacyKey = getLegacyKey();
  if (legacyKey) {
    return legacyKey;
  }

  // 4. No key available
  throw new VaultLockedError();
}


export function encrypt(text) {
  const keyBuffer = getEncryptionKey();
  return encryptWithKey(text, keyBuffer);
}

export function decrypt(encryptedText) {
  const keyBuffer = getEncryptionKey();
  return decryptWithKey(encryptedText, keyBuffer);
}

/**
 * Decrypt text but return '[Locked]' instead of throwing if the vault is locked
 * or if decryption fails. Useful for listing operations where we want to show
 * that data exists without revealing its value.
 */
export function safeDecrypt(encryptedText) {
  try {
    const keyBuffer = getEncryptionKey();
    return decryptWithKey(encryptedText, keyBuffer);
  } catch (err) {
    if (err instanceof VaultLockedError || err.message.includes('Decryption failed')) {
      return '[Locked]';
    }
    throw err;
  }
}

/**
 * Encrypt text with an explicitly provided key buffer.
 * Used by the migration flow to encrypt with the new master key.
 */
export function encryptWithKey(text, keyBuffer) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

/**
 * Decrypt text with an explicitly provided key buffer.
 * Used by the migration flow to decrypt with the legacy key.
 */
export function decryptWithKey(encryptedText, keyBuffer) {
  const [ivHex, encryptedData, authTagHex] = encryptedText.split(':');

  if (!ivHex || !encryptedData || !authTagHex) {
    throw new Error('Invalid encrypted text format. Expected iv:data:tag');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
}