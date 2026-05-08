/**
 * Stricter merchant-name normalization for anomaly fingerprints + user-feedback
 * matching. The detectors used to do `lowercase + trim + collapse-whitespace`
 * only, which left them vulnerable to merchant-name drift very common with
 * Israeli card processors:
 *
 *   "NETFLIX.COM"       vs "NETFLIX 1234"        → split into 2 clusters
 *   "PAYPAL *SPOTIFY"   vs "PAYPAL *NYTIMES"     → kept distinct (good)
 *   "AMAZON 7XK1234"    vs "AMAZON 7XK5678"      → 2 different "merchants"
 *
 * The split made one recurring sub look like two — and the second one would
 * fire `new_recurring` even though it's the same charge under a slightly
 * different reference number.
 *
 * Scope: this normalizer lives in the anomaly module specifically, NOT in
 * recurringDetection.ts. recurringDetection feeds projection + recurring-
 * payments reports too; changing its clustering would shift those screens
 * unpredictably. Anomaly fingerprints can be tightened in isolation —
 * collisions on UPSERT collapse split-detections into a single row, which
 * is what the user actually sees.
 */

const PROCESSOR_PREFIXES = [
    /^paypal\s*[*:]\s*/,    // "PAYPAL *", "PAYPAL: "
    /^sq\s*[*:]\s*/,        // "SQ *" (Square)
    /^sp\s*[*:]\s*/,        // "SP *" (Stripe)
    /^pp\s*[*:]\s*/,        // "PP *"
    /^עסק[ \t]+/,           // "עסק " (Hebrew "business" — common processor prefix)
];

const TLD_SUFFIXES = [
    /\.co\.il\b.*$/,
    /\.com\b.*$/,
    /\.net\b.*$/,
];

/**
 * Normalize a merchant string for keying. Idempotent. Defensive against
 * empty / non-string input — callers don't need to pre-validate.
 */
export function normalizeMerchant(name: string | null | undefined): string {
    if (typeof name !== 'string') return '';
    let s = name.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!s) return '';

    // Strip a known processor prefix (PAYPAL *FOO → "foo"). Loop in case of
    // double-wrapped strings ("PP * PAYPAL *FOO"); rare but cheap to handle.
    for (let i = 0; i < 2; i++) {
        const before = s;
        for (const re of PROCESSOR_PREFIXES) s = s.replace(re, '');
        if (s === before) break;
    }

    // Strip TLD suffixes ("netflix.com — billing dept" → "netflix").
    for (const re of TLD_SUFFIXES) s = s.replace(re, '');

    // Drop trailing reference tokens that processors sprinkle on the end:
    //   "amazon 7xk1234" → "amazon"
    //   "netflix 12345"  → "netflix"
    // The pattern requires the trailing token to include at least one digit
    // (otherwise we'd strip the genuine last word of names like
    // "Apple Music"). 3+ alphanumeric chars, optionally preceded by `#`/`-`.
    s = s.replace(/\s+[#-]?(?=[0-9a-z]*\d)[0-9a-z]{3,}$/i, '');

    // Drop trailing punctuation that survives the above.
    s = s.replace(/[.,*\-_:#\s]+$/g, '').trim();

    return s;
}
