-- Migration: Telegram provider settings.
-- Telegram is added as a parallel notification channel alongside WhatsApp.
-- All four keys are seeded with safe defaults (off, empty) so the settings
-- UI has rows to render even before the user touches anything.
-- Idempotent: ON CONFLICT DO NOTHING preserves any value the user may have
-- already saved in a hand-edited row.

INSERT INTO app_settings (key, value, description)
VALUES
    (
        'telegram_enabled',
        'false'::jsonb,
        'Send notifications via Telegram (works in parallel with WhatsApp if both are enabled)'
    ),
    (
        'telegram_bot_token',
        '""'::jsonb,
        'Telegram bot token from @BotFather (e.g. 123456:ABC-DEF...)'
    ),
    (
        'telegram_to',
        '""'::jsonb,
        'Comma-separated Telegram chat IDs to send to (positive for users/bots, negative for groups, e.g. -1001234567890)'
    ),
    (
        'telegram_notify_on_restart',
        'false'::jsonb,
        'Send a Telegram message when the app restarts and the vault is waiting to be unlocked'
    )
ON CONFLICT (key) DO NOTHING;
