import logger from '../logger.js';

/**
 * WhatsApp provider — currently a thin wrapper over the existing
 * whatsapp-web.js client (see ../whatsapp.js + ../whatsapp-client.js).
 *
 * The wrapper exists so the dispatcher can treat WhatsApp like any other
 * channel; the provider contract is what stays stable when we eventually
 * swap the underlying transport (Baileys migration — see
 * docs/MIGRATION_BAILEYS.md). Call sites depend on this provider, not on
 * the whatsapp-web.js API.
 */

export const whatsappProvider = {
    id: 'whatsapp',

    isEnabled(purpose, s) {
        if (!s.whatsapp_to) return false;
        if (purpose === 'restart_notify') return Boolean(s.whatsapp_notify_on_restart);
        // daily_summary + test: gated by the main toggle.
        return Boolean(s.whatsapp_enabled);
    },

    async send(args, s) {
        const { body } = args;
        // Lazy import: pulls puppeteer + whatsapp-web.js into the bundle. Anyone
        // who hits the dispatcher with no WA settings configured shouldn't pay
        // that cost.
        const { sendWhatsAppMessage } = await import('../whatsapp.js');
        const to = String(s.whatsapp_to || '').replace(/"/g, '');
        if (!to) throw new Error('WhatsApp has no recipients configured');
        const result = await sendWhatsAppMessage({ to, body });
        logger.info({ sent: result.sent, total: result.total }, '[whatsapp] dispatched');
        return result;
    },
};
