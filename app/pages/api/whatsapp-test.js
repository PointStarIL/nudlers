import { getDB } from './db.js';
import { generateDailySummary } from '../../utils/summary.js';
import { sendWhatsAppMessage } from '../../utils/whatsapp.js';
import logger from '../../utils/logger.js';

// Hard ceiling on how long this handler holds the response open. Reverse
// proxies in front of this app (Synology DSM, generic nginx defaults)
// idle-timeout an upstream around 30s and substitute their own HTML 504
// page when that hits — which is what causes the browser-side
// "Unexpected token '<', '<!DOCTYPE'..." JSON parse error even on cold
// Baileys sends that *do* eventually relay the message successfully. By
// returning JSON before the proxy budget runs out we keep the UI honest
// while letting the underlying send finish in the background.
const PROXY_BUDGET_MS = 20_000;

/**
 * POST /api/whatsapp-test
 * Tests the WhatsApp configuration by generating a summary and sending it.
 * Returns the generated message and send status.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const client = await getDB();

    try {
        // Get WhatsApp settings
        const settingsResult = await client.query(
            `SELECT key, value FROM app_settings 
             WHERE key IN ('whatsapp_enabled', 'whatsapp_to')`
        );

        const settings = {};
        for (const row of settingsResult.rows) {
            settings[row.key] = typeof row.value === 'string'
                ? row.value.replace(/"/g, '')
                : row.value;
        }

        // Validate required settings
        if (!settings.whatsapp_to) {
            return res.status(400).json({
                success: false,
                error: 'Missing "To Number" setting in WhatsApp configuration.',
                message: null
            });
        }

        // Generate the summary message
        let generatedMessage;
        try {
            logger.info('[whatsapp-test] Generating daily summary for test');
            generatedMessage = await generateDailySummary();
        } catch (summaryError) {
            logger.error({ error: summaryError.message }, '[whatsapp-test] Failed to generate summary');
            return res.status(500).json({
                success: false,
                error: `Failed to generate summary: ${summaryError.message}`,
                message: null
            });
        }

        // Send the WhatsApp message
        logger.info({ to: settings.whatsapp_to }, '[whatsapp-test] Attempting to send test message');
        const sendPromise = sendWhatsAppMessage({
            to: settings.whatsapp_to,
            body: generatedMessage
        });
        // Swallow late rejections so we don't trigger an unhandledRejection
        // warning if the timeout wins and the send eventually fails.
        sendPromise.catch((err) => {
            logger.warn({ err: err.message }, '[whatsapp-test] Background send completed with error after timeout');
        });

        const TIMEOUT_SENTINEL = Symbol('timeout');
        const winner = await Promise.race([
            sendPromise.then((result) => ({ kind: 'ok', result }), (err) => ({ kind: 'err', err })),
            new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), PROXY_BUDGET_MS)),
        ]);

        if (winner === TIMEOUT_SENTINEL) {
            logger.warn(
                { budgetMs: PROXY_BUDGET_MS },
                '[whatsapp-test] Send did not complete within proxy budget — returning queued response'
            );
            // Best-effort response. The Baileys send is still running in
            // the background; the message will arrive shortly. The UI sees
            // a green checkmark instead of an HTML 504 from the proxy.
            return res.status(200).json({
                success: true,
                queued: true,
                message: generatedMessage,
                results: null,
                note: 'Send is still completing in the background — check WhatsApp in a few seconds.',
                error: null
            });
        }

        if (winner.kind === 'err') {
            const sendError = winner.err;
            logger.error({ error: sendError.message }, '[whatsapp-test] Failed to send message');
            return res.status(500).json({
                success: false,
                error: sendError.message,
                message: generatedMessage
            });
        }

        logger.info('[whatsapp-test] Test message sent successfully');
        return res.status(200).json({
            success: true,
            message: generatedMessage,
            results: winner.result.results,
            error: null
        });
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack }, '[whatsapp-test] Unexpected error in handler');
        return res.status(500).json({
            success: false,
            error: `Internal server error: ${error.message}`,
            message: null
        });
    } finally {
        client.release();
    }
}
