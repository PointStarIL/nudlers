import { getDB } from '../../db';
import VaultStore from '../../utils/VaultStore';
import logger from '../../../../utils/logger.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        return listPasskeys(req, res);
    } else if (req.method === 'DELETE') {
        return clearAllPasskeys(req, res);
    }
    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

async function listPasskeys(req, res) {
    let db;
    try {
        db = await getDB();
        const result = await db.query(
            'SELECT id, credential_id, created_at FROM vault_passkeys ORDER BY created_at DESC'
        );

        res.status(200).json({
            passkeys: result.rows.map(row => ({
                id: row.id,
                credentialId: row.credential_id,
                createdAt: row.created_at,
            })),
            total: result.rows.length
        });
    } catch (err) {
        logger.error({ error: err.message }, 'Failed to list passkeys');
        res.status(500).json({ error: 'Failed to list passkeys' });
    } finally {
        if (db) db.release();
    }
}

async function clearAllPasskeys(req, res) {
    if (VaultStore.isLocked()) {
        return res.status(403).json({ error: 'Vault must be unlocked to manage passkeys' });
    }

    let db;
    try {
        db = await getDB();
        const result = await db.query('DELETE FROM vault_passkeys');
        const cleared = result.rowCount || 0;
        logger.info({ cleared }, 'All passkeys cleared');
        res.status(200).json({ success: true, cleared });
    } catch (err) {
        logger.error({ error: err.message }, 'Failed to clear passkeys');
        res.status(500).json({ error: 'Failed to clear passkeys' });
    } finally {
        if (db) db.release();
    }
}
