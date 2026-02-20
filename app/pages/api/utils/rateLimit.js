import crypto from 'crypto';

function getClientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Simple in-memory token bucket. Good enough for single-instance/personal deployments.
// NOTE: Not suitable as-is for multi-instance or serverless cold starts.
const buckets = new Map();

export function rateLimit({
  keyPrefix,
  limit,
  windowMs,
}) {
  if (!keyPrefix) throw new Error('rateLimit: keyPrefix is required');
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('rateLimit: invalid limit');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('rateLimit: invalid windowMs');

  return function check(req, res) {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    const entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }

    entry.count += 1;
    if (entry.count <= limit) {
      return { ok: true };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    if (res?.setHeader) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      // Avoid caching rate-limited responses
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }

    // Small jitter to reduce thundering herd on clients retrying instantly
    const id = crypto.randomBytes(3).toString('hex');
    return { ok: false, error: `Too many requests. Please try again soon. (${id})` };
  };
}

