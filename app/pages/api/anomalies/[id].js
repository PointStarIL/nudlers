import { getDB } from '../db';
import logger from '../../../utils/logger.js';

/**
 * Status transitions for a single anomaly:
 *   PATCH /api/anomalies/[id]  body: { status: 'acknowledged' | 'dismissed' | 'normal' }
 *
 * Open is the only initial state — clients shouldn't transition *into* open
 * (that's the evaluator's job). All other transitions are one-way.
 */

const ALLOWED_TRANSITIONS = new Set(['acknowledged', 'dismissed', 'normal']);

export default async function handler(req, res) {
    if (req.method !== 'PATCH') {
        res.setHeader('Allow', ['PATCH']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid id' });
    }

    const status = (req.body?.status || '').toString();
    if (!ALLOWED_TRANSITIONS.has(status)) {
        return res.status(400).json({
            error: `Invalid status. Must be one of: ${[...ALLOWED_TRANSITIONS].join(', ')}`,
        });
    }

    // Map status → which timestamp column to set (so the UI can show "dismissed N min ago").
    const timestampColumn = status === 'acknowledged' ? 'acknowledged_at' :
        status === 'dismissed' ? 'dismissed_at' : null;

    const client = await getDB();
    try {
        const setTimestamp = timestampColumn ? `, ${timestampColumn} = CURRENT_TIMESTAMP` : '';
        const result = await client.query(
            `UPDATE anomalies
             SET status = $1, updated_at = CURRENT_TIMESTAMP${setTimestamp}
             WHERE id = $2
             RETURNING id, status, acknowledged_at, dismissed_at, updated_at`,
            [status, id],
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Anomaly not found' });
        }

        return res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error({ err: err.message, id }, '[anomalies] PATCH failed');
        return res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        client.release();
    }
}
