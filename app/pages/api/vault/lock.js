import VaultStore from '../utils/VaultStore';
import logger from '../../../utils/logger.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    try {
        const wasLocked = VaultStore.isLocked();
        VaultStore.clear();

        logger.info({ wasLocked }, '[Vault] Vault manually locked');

        res.status(200).json({
            success: true,
            message: 'Vault locked successfully',
            locked: true
        });
    } catch (err) {
        logger.error({ error: err.message }, '[Vault] Failed to lock vault');
        res.status(500).json({ error: 'Failed to lock vault' });
    }
}
