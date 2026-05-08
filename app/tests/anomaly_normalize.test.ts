import { describe, it, expect } from 'vitest';
import { normalizeMerchant } from '../utils/anomaly/normalize';

describe('normalizeMerchant', () => {
    it('lowercases, trims, and collapses internal whitespace', () => {
        expect(normalizeMerchant('  Apple   Music  ')).toBe('apple music');
        expect(normalizeMerchant('NETFLIX')).toBe('netflix');
    });

    it('strips trailing reference digits', () => {
        // Common Israeli card-processor pattern: merchant name + ref number.
        expect(normalizeMerchant('NETFLIX 1234')).toBe('netflix');
        expect(normalizeMerchant('AMAZON 7XK1234')).toBe('amazon');
    });

    it('strips processor prefixes (PAYPAL, SQ, SP)', () => {
        expect(normalizeMerchant('PAYPAL *SPOTIFY')).toBe('spotify');
        expect(normalizeMerchant('SQ *Local Coffee')).toBe('local coffee');
        expect(normalizeMerchant('SP *Stripe Inc')).toBe('stripe inc');
    });

    it('strips TLD-style suffixes', () => {
        expect(normalizeMerchant('NETFLIX.COM')).toBe('netflix');
        expect(normalizeMerchant('cibus.co.il')).toBe('cibus');
    });

    it('collapses split-merchant variants to the same key', () => {
        // The whole point: the two split variants should map to one key
        // so anomaly fingerprints collapse on UPSERT.
        const a = normalizeMerchant('NETFLIX.COM');
        const b = normalizeMerchant('NETFLIX 1234');
        const c = normalizeMerchant('netflix');
        expect(a).toBe(c);
        expect(b).toBe(c);
    });

    it('is defensive against empty / non-string input', () => {
        expect(normalizeMerchant('')).toBe('');
        expect(normalizeMerchant(null)).toBe('');
        expect(normalizeMerchant(undefined)).toBe('');
    });

    it('preserves merchants without trailing junk', () => {
        // Don't over-strip — short word-only names keep their identity.
        expect(normalizeMerchant('IKEA')).toBe('ikea');
        expect(normalizeMerchant('Apple Music')).toBe('apple music');
    });

    it('strips trailing punctuation that survives the other passes', () => {
        expect(normalizeMerchant('Spotify *')).toBe('spotify');
        expect(normalizeMerchant('Some Merchant -')).toBe('some merchant');
    });
});
