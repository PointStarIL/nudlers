import logger from '../logger.js';
import { loadMessagingSettings } from './settings.js';
import { whatsappProvider } from './whatsappProvider.js';
import { telegramProvider } from './telegramProvider.js';

/**
 * Default registered providers. Tests inject their own through `providers`.
 * Order is informational; sends are fanned out in parallel.
 */
const DEFAULT_PROVIDERS = [whatsappProvider, telegramProvider];

/**
 * Send a notification through every enabled-for-purpose provider in parallel.
 *
 * Failures from one provider never break another — that is the entire point
 * of having two channels. The caller gets back per-provider results so it
 * can log/audit each outcome individually.
 *
 * @param {Object} args
 * @param {string} args.body
 * @param {'daily_summary'|'restart_notify'|'test'} args.purpose
 * @param {Object} [args.deps]                Test override for getDB.
 * @param {Array} [args.providers]            Test override for the provider list.
 * @returns {Promise<{ success: boolean, attempted: number, succeeded: number, results: Array }>}
 */
export async function sendNotification({ body, purpose, deps, providers }) {
    if (!body || typeof body !== 'string') {
        throw new Error('sendNotification requires a non-empty body');
    }
    if (!purpose) {
        throw new Error('sendNotification requires a purpose');
    }

    const getDB = deps?.getDB || (await import('../../pages/api/db.js')).getDB;
    const list = providers || DEFAULT_PROVIDERS;

    const settings = await loadMessagingSettings({ getDB });
    const active = list.filter((p) => p.isEnabled(purpose, settings));

    if (active.length === 0) {
        logger.info({ purpose }, '[messaging] no providers enabled — skipping');
        return { success: false, attempted: 0, succeeded: 0, results: [], reason: 'no_providers_enabled' };
    }

    const settled = await Promise.allSettled(
        active.map((p) => p.send({ body, purpose }, settings))
    );

    const results = settled.map((r, i) => {
        const provider = active[i].id;
        if (r.status === 'fulfilled') {
            return { provider, success: true, ...r.value };
        }
        const err = r.reason;
        logger.error({ provider, err: err?.message, stack: err?.stack }, '[messaging] provider failed');
        return { provider, success: false, error: err?.message || 'unknown error' };
    });

    const succeeded = results.filter((r) => r.success).length;
    logger.info(
        { purpose, attempted: active.length, succeeded, providers: results.map((r) => `${r.provider}:${r.success}`) },
        '[messaging] dispatch complete'
    );

    return {
        success: succeeded > 0,
        attempted: active.length,
        succeeded,
        results,
    };
}
