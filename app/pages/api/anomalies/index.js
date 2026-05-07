import { getDB } from '../db';
import logger from '../../../utils/logger.js';

/**
 * Anomaly inbox + manual evaluator trigger.
 *
 *   GET  /api/anomalies?status=open          → list anomalies (default: open)
 *   POST /api/anomalies (no body)            → run the evaluator now and return summary
 *
 * The list endpoint returns rows sorted high-severity first, then newest first
 * — that's the order the UI's Insights view renders them.
 */

const VALID_STATUSES = ['open', 'acknowledged', 'dismissed', 'normal'];
const SEVERITY_RANK = `CASE severity
    WHEN 'high' THEN 0
    WHEN 'medium' THEN 1
    WHEN 'low' THEN 2
    ELSE 3
END`;

export default async function handler(req, res) {
    if (req.method === 'GET') return getHandler(req, res);
    if (req.method === 'POST') return postHandler(req, res);
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

async function getHandler(req, res) {
    const status = (req.query.status || 'open').toString();
    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status filter: ${status}` });
    }

    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, type, severity, fingerprint, title, body, payload,
                    related_transaction_keys, status,
                    created_at, updated_at, acknowledged_at, dismissed_at
             FROM anomalies
             WHERE status = $1
             ORDER BY ${SEVERITY_RANK}, created_at DESC
             LIMIT 200`,
            [status],
        );

        // Headcount per type so the UI can render filter chips without a 2nd request.
        const counts = await client.query(
            `SELECT type, COUNT(*)::int AS n
             FROM anomalies
             WHERE status = 'open'
             GROUP BY type`,
        );
        const countByType = {};
        for (const row of counts.rows) countByType[row.type] = row.n;

        res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
        return res.status(200).json({
            anomalies: result.rows,
            countByType,
            total: result.rowCount,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[anomalies] GET failed');
        return res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        client.release();
    }
}

async function postHandler(req, res) {
    try {
        // Lazy-import keeps the API route lean for GET callers.
        const { evaluateAnomalies } = await import('../../../utils/anomaly/evaluate.js');
        const summary = await evaluateAnomalies();
        return res.status(200).json(summary);
    } catch (err) {
        logger.error({ err: err.message }, '[anomalies] Manual evaluation failed');
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
