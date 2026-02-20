import { unlockVaultWithPassphrase } from '../../../utils/vault-utils';
import logger from '../../../utils/logger.js';
import { rateLimit } from '../utils/rateLimit.js';

// Rate limit: 10 attempts per 15 minutes per IP to prevent brute-force.
const unlockLimiter = rateLimit({ keyPrefix: 'vault-unlock', limit: 10, windowMs: 15 * 60 * 1000 });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const limitResult = unlockLimiter(req, res);
    if (!limitResult.ok) {
        return res.status(429).json({ error: limitResult.error });
    }

    const { passphrase } = req.body;

    if (!passphrase) {
        return res.status(400).json({ error: 'Passphrase is required' });
    }

    const result = await unlockVaultWithPassphrase(passphrase);

    if (result.success) {
        logger.info("Vault unlocked successfully");
        res.status(200).json({ success: true, message: 'Vault unlocked' });
    } else {
        // Return a generic 401 — never leak internal error detail to the client.
        logger.warn({ error: result.error }, 'Vault unlock attempt failed');
        res.status(401).json({ error: 'Invalid passphrase' });
    }
}
