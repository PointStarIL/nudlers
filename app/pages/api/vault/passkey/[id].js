import { getDB } from '../../db';
import VaultStore from '../../utils/VaultStore';
import logger from '../../../../utils/logger.js';

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        res.setHeader('Allow', ['DELETE']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    if (VaultStore.isLocked()) {
        return res.status(403).json({ error: 'Vault must be unlocked to manage passkeys' });
    }

    const { id } = req.query;

    if (!id || isNaN(Number(id))) {
        return res.status(400).json({ error: 'Invalid passkey ID' });
    }

    let db;
    try {
        db = await getDB();
        const result = await db.query('DELETE FROM vault_passkeys WHERE id = $1', [Number(id)]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Passkey not found' });
        }

        logger.info({ passkeyId: id }, 'Passkey deleted');
        res.status(200).json({ success: true });
    } catch (err) {
        logger.error({ error: err.message, passkeyId: id }, 'Failed to delete passkey');
        res.status(500).json({ error: 'Failed to delete passkey' });
    } finally {
        if (db) db.release();
    }
}
