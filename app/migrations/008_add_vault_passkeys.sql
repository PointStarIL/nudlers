-- Add table for vault passkeys
CREATE TABLE IF NOT EXISTS vault_passkeys (
  id SERIAL PRIMARY KEY,
  credential_id TEXT UNIQUE NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSONB,
  encrypted_passphrase TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vault_passkeys_credential_id ON vault_passkeys(credential_id);
