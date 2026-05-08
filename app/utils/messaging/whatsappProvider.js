import logger from '../logger.js';

/**
 * WhatsApp provider — thin wrapper over the Baileys client (see
 * ../whatsapp.js + ../whatsapp-client.js).
 *
 * The wrapper exists so the dispatcher can treat WhatsApp like any other
 * channel. Call sites depend on this provider, not on the Baileys API
 * directly, so transport changes stay scoped to whatsapp-client.js.
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
        // Lazy import: pulls Baileys into the bundle. Anyone who hits the
        // dispatcher with no WA settings configured shouldn't pay that cost.
        const { sendWhatsAppMessage } = await import('../whatsapp.js');
        const to = String(s.whatsapp_to || '').replace(/"/g, '');
        if (!to) throw new Error('WhatsApp has no recipients configured');
        const result = await sendWhatsAppMessage({ to, body });
        logger.info({ sent: result.sent, total: result.total }, '[whatsapp] dispatched');
        return result;
    },
};
