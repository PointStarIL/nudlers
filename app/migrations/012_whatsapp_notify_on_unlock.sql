-- Migration: WhatsApp notification when the vault is unlocked after a restart.
-- Off by default. When enabled, the next successful unlock following a process
-- start fires a one-shot WhatsApp message to the configured recipients.

INSERT INTO app_settings (key, value, description)
VALUES (
    'whatsapp_notify_on_unlock',
    'false'::jsonb,
    'Send a WhatsApp message the first time the vault is unlocked after an app restart'
)
ON CONFLICT (key) DO NOTHING;
