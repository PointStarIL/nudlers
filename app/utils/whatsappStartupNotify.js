import logger from './logger.js';

/**
 * Send a WhatsApp message at app startup if the vault is initialized but
 * locked — i.e. "the app just came back online and it's waiting for you to
 * unlock it." This is the only signal you get that something restarted your
 * server (NAS reboot, deploy, OOM) without having to constantly check.
 *
 * The vault is *always* locked at startup by design: the master key lives in
 * memory only and is wiped on process exit. So "vault is locked" is a sloppy
 * way of saying "this is a fresh boot." We still gate on `wrapped_master_key`
 * existing so we don't spam users who haven't initialized the vault at all.
 *
 * Fire-and-forget by design — the caller in instrumentation.ts should not
 * await this. A missing WhatsApp client, a stale session, or a network blip
 * must never break startup.
 */

const READY_TIMEOUT_MS = 90_000;

export async function notifyAppStartedWithLockedVault(opts = {}) {
    const { getDB, sendWhatsAppMessage, getOrCreateClient, now } = await resolveDependencies(opts);

    let vaultIsInitialized = false;
    let enabled = false;
    let recipients = '';

    const dbClient = await getDB();
    try {
        const result = await dbClient.query(
            `SELECT key, value FROM app_settings
             WHERE key IN ('wrapped_master_key', 'whatsapp_notify_on_restart', 'whatsapp_to')`
        );
        for (const row of result.rows) {
            if (row.key === 'wrapped_master_key') {
                // Initialized iff the wrapped key is a non-empty string.
                let v = row.value;
                try { v = JSON.parse(v); } catch { /* fall through with raw */ }
                vaultIsInitialized = typeof v === 'string' && v.length > 0;
            } else if (row.key === 'whatsapp_notify_on_restart') {
                try { enabled = JSON.parse(row.value) === true; } catch { enabled = row.value === 'true'; }
            } else if (row.key === 'whatsapp_to') {
                try { recipients = JSON.parse(row.value) || ''; } catch { recipients = String(row.value || '').replace(/"/g, ''); }
            }
        }
    } finally {
        // release() shouldn't throw in pg, but if it ever does, swallow it —
        // a prior error from inside the try block is more important to surface.
        try { dbClient.release(); } catch { /* ignore */ }
    }

    // Strip leading/trailing whitespace; "  " shouldn't count as recipients.
    recipients = typeof recipients === 'string' ? recipients.trim() : '';

    if (!vaultIsInitialized) {
        logger.info('[startup-notify] Vault not initialized; nothing to unlock — skipping notification');
        return { sent: false, reason: 'not_initialized' };
    }
    if (!enabled) {
        return { sent: false, reason: 'disabled' };
    }
    if (!recipients) {
        logger.info('[startup-notify] Notification enabled but no whatsapp_to configured — skipping');
        return { sent: false, reason: 'no_recipients' };
    }

    // Wait for WhatsApp to authenticate from its persisted session (or whatever
    // state it ends up in). At server boot this is usually still happening —
    // no point sending while the client is in INITIALIZING.
    try {
        await waitForWhatsAppReady({ getOrCreateClient, timeoutMs: READY_TIMEOUT_MS });
    } catch (err) {
        logger.warn({ err: err.message }, '[startup-notify] WhatsApp not ready in time; dropping notification');
        return { sent: false, reason: 'whatsapp_not_ready' };
    }

    const when = now ?? new Date();
    const time = when.toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
    const body = `🔒 Nudlers — האפליקציה הופעלה מחדש\nהכספת נעולה ומחכה לפתיחה\n${time}`;

    await sendWhatsAppMessage({ to: recipients, body });
    logger.info('[startup-notify] Notification sent — app restarted with locked vault');
    return { sent: true, reason: 'ok' };
}

/**
 * Resolve module dependencies. Production passes nothing and we lazy-import
 * everything to avoid pulling whatsapp-web.js into bundles that don't need
 * it. Tests pass overrides for easy mocking without `vi.mock` gymnastics.
 */
async function resolveDependencies(overrides) {
    if (overrides.getDB && overrides.sendWhatsAppMessage && overrides.getOrCreateClient) {
        return overrides;
    }
    const dbModule = await import('../pages/api/db');
    const waModule = await import('./whatsapp.js');
    const waClientModule = await import('./whatsapp-client.js');
    return {
        getDB: overrides.getDB || dbModule.getDB,
        sendWhatsAppMessage: overrides.sendWhatsAppMessage || waModule.sendWhatsAppMessage,
        getOrCreateClient: overrides.getOrCreateClient || waClientModule.getOrCreateClient,
        now: overrides.now,
    };
}

/**
 * Resolve when the WhatsApp client is READY (or AUTHENTICATED). Short-circuits
 * if it's already there. Otherwise listens for the underlying client's events
 * with a hard timeout so we never hang forever on a vault that needs a fresh
 * QR scan.
 */
function waitForWhatsAppReady({ getOrCreateClient, timeoutMs }) {
    const globalAny = globalThis;
    const isReady = () => {
        const s = globalAny.whatsappStatus;
        return s === 'READY' || s === 'AUTHENTICATED';
    };
    if (isReady()) return Promise.resolve();

    const client = getOrCreateClient();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            client.off?.('ready', onReady);
            client.off?.('authenticated', onAuthed);
            client.off?.('auth_failure', onFail);
        };
        const onReady = () => { cleanup(); resolve(); };
        const onAuthed = () => { cleanup(); resolve(); };
        const onFail = (msg) => { cleanup(); reject(new Error(`WhatsApp authentication failure: ${msg}`)); };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`WhatsApp client did not become ready within ${timeoutMs}ms`));
        }, timeoutMs);
        client.once('ready', onReady);
        client.once('authenticated', onAuthed);
        client.once('auth_failure', onFail);

        // Closes the TOCTOU race: between the initial isReady() above and the
        // listener registration, the underlying client could have fired the
        // event we'd otherwise miss. Re-check now that we're listening.
        if (isReady()) {
            cleanup();
            resolve();
        }
    });
}
