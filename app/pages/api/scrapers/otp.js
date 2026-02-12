import logger from '../../../utils/logger.js';

/**
 * Global OTP store for passing OTP codes from the API to the scraper.
 * Uses a promise-based approach: the scraper awaits `waitForOtp()`,
 * and when the user submits the code via POST, it resolves the promise.
 */
if (!global.otpStore) {
    global.otpStore = {
        resolve: null,
        reject: null,
        promise: null,
        companyId: null,
        timestamp: null,
    };
}

/**
 * Request an OTP from the user. Called by the scraper when it detects a 2FA page.
 * Returns a promise that resolves with the OTP code when the user submits it.
 * @param {string} companyId - The vendor/company requesting OTP
 * @param {number} timeoutMs - Maximum time to wait for OTP (default: 2 minutes)
 */
export function waitForOtp(companyId, timeoutMs = 120000) {
    // Clean up any existing pending OTP request
    if (global.otpStore.reject) {
        global.otpStore.reject(new Error('New OTP request superseded the previous one'));
    }

    return new Promise((resolve, reject) => {
        global.otpStore = {
            resolve,
            reject,
            companyId,
            timestamp: Date.now(),
        };

        // Timeout if user doesn't submit OTP in time
        setTimeout(() => {
            if (global.otpStore.resolve === resolve) {
                global.otpStore = { resolve: null, reject: null, companyId: null, timestamp: null };
                reject(new Error(`OTP timeout: No code submitted within ${timeoutMs / 1000} seconds`));
            }
        }, timeoutMs);
    });
}

/**
 * Check if there is a pending OTP request
 */
export function hasPendingOtp() {
    return global.otpStore.resolve !== null;
}

/**
 * Clear any pending OTP request
 */
export function clearPendingOtp() {
    if (global.otpStore.reject) {
        global.otpStore.reject(new Error('OTP request cancelled'));
    }
    global.otpStore = { resolve: null, reject: null, companyId: null, timestamp: null };
}


async function handler(req, res) {
    if (req.method === 'POST') {
        // Submit an OTP code
        const { otpCode } = req.body;

        if (!otpCode || typeof otpCode !== 'string' || otpCode.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'OTP code is required' });
        }

        if (!global.otpStore.resolve) {
            return res.status(409).json({ success: false, message: 'No pending OTP request' });
        }

        const code = otpCode.trim();
        logger.info({ companyId: global.otpStore.companyId, codeLength: code.length }, '[OTP] Code submitted by user');

        // Resolve the waiting scraper promise
        const resolve = global.otpStore.resolve;
        global.otpStore = { resolve: null, reject: null, companyId: null, timestamp: null };
        resolve(code);

        return res.status(200).json({ success: true, message: 'OTP code submitted successfully' });
    }

    if (req.method === 'GET') {
        // Check if there's a pending OTP request
        return res.status(200).json({
            pending: hasPendingOtp(),
            companyId: global.otpStore.companyId,
            timestamp: global.otpStore.timestamp,
        });
    }

    return res.status(405).json({ message: 'Method not allowed' });
}

export default handler;
