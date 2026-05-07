import logger from '../logger.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 15_000;

/**
 * Telegram bot provider. Talks straight to the Bot HTTP API — no SDK, no
 * stateful socket, no Chromium. A bot token is the only credential the user
 * needs to provide; recipients are chat IDs (positive for users/bots,
 * negative for groups, e.g. -1001234567890 for supergroups).
 *
 * Why direct fetch instead of `node-telegram-bot-api`/`telegraf`/`grammy`?
 * Those libs are designed for *receiving* updates (long-poll/webhook). We
 * only need outbound `sendMessage`, so a 30-line POST keeps the dependency
 * surface small and the failure modes obvious.
 */

function splitRecipients(raw) {
    return String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

async function postJson(url, body, { timeoutMs = SEND_TIMEOUT_MS } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        let data = null;
        try { data = await res.json(); } catch { /* non-JSON error body — keep null */ }
        return { res, data };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Verify a bot token by hitting `/getMe`. Used by the test endpoint to give
 * users an immediate "yes/no, your token is valid" signal before they try
 * to send anything real.
 */
export async function verifyTelegramToken(token) {
    if (!token) throw new Error('Bot token is required');
    const url = `${TELEGRAM_API_BASE}/bot${encodeURIComponent(token)}/getMe`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
            const msg = data?.description || `HTTP ${res.status}`;
            throw new Error(`Telegram getMe failed: ${msg}`);
        }
        return data.result;
    } finally {
        clearTimeout(timer);
    }
}

export const telegramProvider = {
    id: 'telegram',

    isEnabled(purpose, s) {
        if (!s.telegram_enabled) return false;
        if (!s.telegram_bot_token || !s.telegram_to) return false;
        if (purpose === 'restart_notify') return Boolean(s.telegram_notify_on_restart);
        // daily_summary + test: if the channel is enabled and configured, send.
        return true;
    },

    async send(args, s) {
        const { body } = args;
        const token = s.telegram_bot_token;
        const recipients = splitRecipients(s.telegram_to);

        if (recipients.length === 0) {
            throw new Error('Telegram has no recipients configured');
        }

        const url = `${TELEGRAM_API_BASE}/bot${encodeURIComponent(token)}/sendMessage`;
        const results = [];

        for (const chatId of recipients) {
            try {
                const { res, data } = await postJson(url, {
                    chat_id: chatId,
                    text: body,
                    disable_web_page_preview: true,
                });

                if (!res.ok || !data?.ok) {
                    const msg = data?.description || `HTTP ${res.status}`;
                    throw new Error(msg);
                }

                logger.info({ chatId, messageId: data.result.message_id }, '[telegram] message sent');
                results.push({ to: chatId, success: true, messageId: data.result.message_id });
            } catch (err) {
                logger.error({ chatId, err: err.message }, '[telegram] message failed');
                results.push({ to: chatId, success: false, error: err.message });
            }
        }

        const sent = results.filter((r) => r.success).length;
        if (sent === 0) {
            throw new Error(`Telegram failed for all ${recipients.length} recipients`);
        }
        return { success: true, sent, total: recipients.length, results };
    },
};
