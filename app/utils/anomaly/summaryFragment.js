import logger from '../logger.js';

/**
 * Build a short Hebrew preamble of recently-detected anomalies, suitable for
 * pasting at the top of the daily WhatsApp summary. Returns an empty string
 * when there's nothing notable from the last 24 hours — callers can safely
 * concatenate without adding stray separators.
 *
 * Why 24h, not "since last summary": the summary cron runs daily, so anything
 * older than 24h was either already shown yesterday or is no longer fresh.
 *
 * Why high+medium only, not low: low severity exists for the in-app inbox
 * (where the user opts into seeing them) but doesn't earn a WhatsApp
 * interruption. The bar for buzzing someone's phone is higher.
 */
export async function getAnomalyPreambleForSummary({ getDB } = {}) {
    const dbModule = getDB ? null : await import('../../pages/api/db');
    const db = getDB || dbModule.getDB;
    const client = await db();

    try {
        const result = await client.query(
            `SELECT type, severity, title, payload, created_at
             FROM anomalies
             WHERE status = 'open'
               AND severity IN ('high', 'medium')
               AND created_at >= NOW() - INTERVAL '24 hours'
             ORDER BY
                CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                created_at DESC
             LIMIT 5`,
        );

        if (result.rowCount === 0) return '';

        const lines = result.rows.map((r) => formatLine(r));
        return ['🔔 *התראות:*', ...lines, '', '---', ''].join('\n');
    } catch (err) {
        // The summary should never fail because of the anomaly preamble —
        // log and return empty so the daily message still goes out.
        logger.warn({ err: err.message }, '[anomaly-preamble] Failed to build; continuing without it');
        return '';
    } finally {
        client.release();
    }
}

/**
 * Per-anomaly bullet text. Detector-specific rendering keeps each line crisp
 * — the user shouldn't have to read JSON to understand what fired.
 */
function formatLine(row) {
    const p = row.payload || {};
    if (row.type === 'price_hike') {
        const merchant = p.merchant ?? '?';
        const from = formatIls(p.priorAverage);
        const to = formatIls(p.newAmount);
        return `• *${merchant}* התייקר: ₪${from} → ₪${to}`;
    }
    if (row.type === 'new_recurring') {
        const merchant = p.merchant ?? '?';
        const amount = formatIls(p.monthlyAmount);
        return `• מנוי חדש: *${merchant}* (₪${amount}/חודש)`;
    }
    if (row.type === 'category_spike') {
        const cat = p.category ?? '?';
        const ratio = typeof p.ratio === 'number' ? p.ratio.toFixed(1).replace(/\.0$/, '') : '?';
        const spend = formatIls(p.thisWeekSpend);
        return `• *${cat}* השבוע: ₪${spend} (${ratio}× מהרגיל)`;
    }
    // Unknown type — fall back to title, never crash.
    return `• ${row.title}`;
}

function formatIls(n) {
    if (typeof n !== 'number') return '?';
    return n.toFixed(2).replace(/\.00$/, '');
}
