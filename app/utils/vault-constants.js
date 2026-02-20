export const VAULT_MASTER_KEY_BYTES = 32; // 256-bit master key
export const VAULT_GCM_IV_BYTES = 12; // Recommended IV length for AES-GCM
export const VAULT_MIN_PASSPHRASE_LENGTH = 8;

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const PASSKEY_SECRET_MIN_CHARS = 32;
export const PASSKEY_KDF_SALT_BYTES = 16;
