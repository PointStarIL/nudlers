import logger from '../logger.js';

/**
 * Keys we read into the messaging settings snapshot. Adding a new provider
 * means appending to this list — nothing else in the dispatcher cares.
 */
const MESSAGING_KEYS = [
    'whatsapp_enabled',
    'whatsapp_to',
    'whatsapp_notify_on_restart',
    'telegram_enabled',
    'telegram_bot_token',
    'telegram_to',
    'telegram_notify_on_restart',
];

/**
 * `value` lives in jsonb, so `pg` returns it already parsed for objects/numbers
 * but as a JSON-encoded string for primitives written via `JSON.stringify`.
 * Strip wrapping quotes for strings, parse booleans/numbers leniently.
 */
function unwrap(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'boolean' || typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed;
        } catch {
            return raw;
        }
    }
    return raw;
}

function asBool(v) {
    if (v === true) return true;
    if (v === 'true') return true;
    return false;
}

function asString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    return String(v);
}

/**
 * Load all messaging-relevant settings from app_settings in one round-trip.
 * Used by the dispatcher before fanning out to providers.
 */
export async function loadMessagingSettings({ getDB }) {
    const client = await getDB();
    try {
        const result = await client.query(
            'SELECT key, value FROM app_settings WHERE key = ANY($1)',
            [MESSAGING_KEYS]
        );

        const raw = {};
        for (const row of result.rows) {
            raw[row.key] = unwrap(row.value);
        }

        return {
            whatsapp_enabled: asBool(raw.whatsapp_enabled),
            whatsapp_to: asString(raw.whatsapp_to),
            whatsapp_notify_on_restart: asBool(raw.whatsapp_notify_on_restart),

            telegram_enabled: asBool(raw.telegram_enabled),
            telegram_bot_token: asString(raw.telegram_bot_token),
            telegram_to: asString(raw.telegram_to),
            telegram_notify_on_restart: asBool(raw.telegram_notify_on_restart),
        };
    } catch (err) {
        logger.error({ err: err.message }, '[messaging] Failed to load settings');
        throw err;
    } finally {
        try { client.release(); } catch { /* ignore */ }
    }
}
