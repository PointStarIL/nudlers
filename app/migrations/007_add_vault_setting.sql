-- Migration to add support for database-backed vault
-- NOTE: value is intentionally an empty string (not '""') so that
-- initialize.js can detect an uninitialized vault with a simple length > 0 check.
INSERT INTO app_settings (key, value, description) VALUES
  ('wrapped_master_key', '', 'The master key wrapped with a passphrase for memory-locked credentials')
ON CONFLICT (key) DO NOTHING;
