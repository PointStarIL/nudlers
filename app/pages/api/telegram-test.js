import { telegramProvider, verifyTelegramToken } from '../../utils/messaging/telegramProvider.js';
import { loadMessagingSettings } from '../../utils/messaging/settings.js';
import { getDB } from './db.js';
import logger from '../../utils/logger.js';

/**
 * POST /api/telegram-test
 *
 * Two flavours via the `mode` body field:
 *  - 'verify' (default): hits Telegram's getMe with the saved bot token.
 *    Cheap, doesn't bother any chats. Used to confirm the token works.
 *  - 'send': fires a short fixed test message to the configured chat IDs.
 *    Used to confirm chat IDs are reachable.
 *
 * We deliberately don't reuse the daily-summary generator here — that's an
 * expensive DB read and the user just wants "did Telegram work or not."
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const mode = (req.body && req.body.mode) || 'verify';

    try {
        const settings = await loadMessagingSettings({ getDB });

        if (!settings.telegram_bot_token) {
            return res.status(400).json({
                success: false,
                error: 'Telegram bot token is not configured',
            });
        }

        if (mode === 'verify') {
            try {
                const bot = await verifyTelegramToken(settings.telegram_bot_token);
                return res.status(200).json({
                    success: true,
                    bot: { id: bot.id, username: bot.username, firstName: bot.first_name },
                });
            } catch (err) {
                logger.warn({ err: err.message }, '[telegram-test] verify failed');
                return res.status(400).json({ success: false, error: err.message });
            }
        }

        if (mode === 'send') {
            if (!settings.telegram_to) {
                return res.status(400).json({
                    success: false,
                    error: 'Telegram has no recipients configured',
                });
            }
            try {
                const result = await telegramProvider.send(
                    {
                        body: 'Nudlers — בדיקת חיבור ✅\nTest message from Nudlers',
                        purpose: 'test',
                    },
                    settings
                );
                return res.status(200).json({ success: true, result });
            } catch (err) {
                logger.warn({ err: err.message }, '[telegram-test] send failed');
                return res.status(400).json({ success: false, error: err.message });
            }
        }

        return res.status(400).json({ success: false, error: `Unknown mode: ${mode}` });
    } catch (error) {
        logger.error({ error: error.message }, '[telegram-test] Internal error');
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
