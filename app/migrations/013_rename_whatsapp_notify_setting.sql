-- Migration: Rename `whatsapp_notify_on_unlock` → `whatsapp_notify_on_restart`.
--
-- The setting was originally implemented to fire after a successful vault
-- unlock; it now fires at app startup when the vault is locked and waiting
-- to be unlocked (PR #99). The name no longer described the behaviour.
--
-- Copy the user's current value to the new key, then drop the old one.
-- Idempotent: safe to re-run.

INSERT INTO app_settings (key, value, description)
SELECT
    'whatsapp_notify_on_restart',
    value,
    'Send a WhatsApp message when the app restarts and the vault is waiting to be unlocked'
FROM app_settings
WHERE key = 'whatsapp_notify_on_unlock'
ON CONFLICT (key) DO NOTHING;

-- If the new key didn't exist before this migration, also seed it as `false`
-- so it shows up in the settings UI even on installs that never enabled the
-- old toggle. Existing users keep whatever value the SELECT above copied.
INSERT INTO app_settings (key, value, description)
VALUES (
    'whatsapp_notify_on_restart',
    'false'::jsonb,
    'Send a WhatsApp message when the app restarts and the vault is waiting to be unlocked'
)
ON CONFLICT (key) DO NOTHING;

DELETE FROM app_settings WHERE key = 'whatsapp_notify_on_unlock';
