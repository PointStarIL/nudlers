import { describe, it, expect } from 'vitest';
import { detectPriceHikes } from '../utils/anomaly/detectors/priceHike';

function tx(date: string, name: string, price: number, account = '1234') {
    return { name, price, account_number: account, date: new Date(date) };
}

describe('detectPriceHikes', () => {
    it('flags a 50% jump after a stable plateau', () => {
        const txs = [
            tx('2026-04-15', 'Apple Music', -29.9),  // hike
            tx('2026-03-15', 'Apple Music', -19.9),
            tx('2026-02-15', 'Apple Music', -19.9),
            tx('2026-01-15', 'Apple Music', -19.9),
        ];
        const out = detectPriceHikes(txs);
        expect(out).toHaveLength(1);
        expect(out[0].severity).toBe('high');
        expect(out[0].type).toBe('price_hike');
        expect(out[0].payload.priorAverage).toBeCloseTo(19.9, 2);
        expect(out[0].payload.newAmount).toBeCloseTo(29.9, 2);
        expect(out[0].title).toContain('Apple Music');
    });

    it('flags a moderate hike at medium severity', () => {
        const txs = [
            tx('2026-04-15', 'Gym', -120),     // 20% hike
            tx('2026-03-15', 'Gym', -100),
            tx('2026-02-15', 'Gym', -100),
            tx('2026-01-15', 'Gym', -100),
        ];
        const out = detectPriceHikes(txs);
        expect(out[0].severity).toBe('medium');
    });

    it('does NOT flag a 5% jump (below relative threshold)', () => {
        const txs = [
            tx('2026-04-15', 'Spotify', -100.5),
            tx('2026-03-15', 'Spotify', -100),
            tx('2026-02-15', 'Spotify', -100),
            tx('2026-01-15', 'Spotify', -95),
        ];
        expect(detectPriceHikes(txs)).toEqual([]);
    });

    it('does NOT flag micro-amount jumps that pass the % but not the absolute threshold', () => {
        const txs = [
            tx('2026-04-15', 'Tiny', -1.5),
            tx('2026-03-15', 'Tiny', -1.0),
            tx('2026-02-15', 'Tiny', -1.0),
            tx('2026-01-15', 'Tiny', -1.0),
        ];
        expect(detectPriceHikes(txs)).toEqual([]);
    });

    it('does NOT flag when there is no stable plateau in history (chaotic prior)', () => {
        // Amounts swing 10-200 — no plateau to hike *from*.
        const txs = [
            tx('2026-04-15', 'Variable', -250),
            tx('2026-03-15', 'Variable', -10),
            tx('2026-02-15', 'Variable', -180),
            tx('2026-01-15', 'Variable', -50),
        ];
        expect(detectPriceHikes(txs)).toEqual([]);
    });

    it('does NOT flag with too few prior data points', () => {
        const txs = [
            tx('2026-04-15', 'New', -50),
            tx('2026-03-15', 'New', -20),
        ];
        expect(detectPriceHikes(txs)).toEqual([]);
    });

    it('separates merchants by account so two cards charging the same merchant are distinct', () => {
        const txs = [
            tx('2026-04-15', 'Netflix', -65, 'card-A'),
            tx('2026-03-15', 'Netflix', -55, 'card-A'),
            tx('2026-02-15', 'Netflix', -55, 'card-A'),
            tx('2026-01-15', 'Netflix', -55, 'card-A'),
            // Same merchant on a different card — its own stable history at a higher price.
            tx('2026-04-15', 'Netflix', -55, 'card-B'),
            tx('2026-03-15', 'Netflix', -55, 'card-B'),
            tx('2026-02-15', 'Netflix', -55, 'card-B'),
            tx('2026-01-15', 'Netflix', -55, 'card-B'),
        ];
        const out = detectPriceHikes(txs);
        expect(out).toHaveLength(1); // only card-A's hike
        expect(out[0].payload.accountNumber).toBe('card-A');
    });

    it('produces a stable fingerprint for the same hike across runs', () => {
        const txs = [
            tx('2026-04-15', 'Netflix', -65),
            tx('2026-03-15', 'Netflix', -55),
            tx('2026-02-15', 'Netflix', -55),
            tx('2026-01-15', 'Netflix', -55),
        ];
        const a = detectPriceHikes(txs)[0];
        const b = detectPriceHikes(txs)[0];
        expect(a.fingerprint).toBe(b.fingerprint);
    });

    it('handles signed amounts correctly (charges are negative)', () => {
        const txs = [
            tx('2026-04-15', 'Spotify', -29.9),
            tx('2026-03-15', 'Spotify', -19.9),
            tx('2026-02-15', 'Spotify', -19.9),
            tx('2026-01-15', 'Spotify', -19.9),
        ];
        const out = detectPriceHikes(txs);
        expect(out).toHaveLength(1);
        expect(out[0].payload.priorAverage).toBeGreaterThan(0);
        expect(out[0].payload.newAmount).toBeGreaterThan(0);
    });

    it('ignores positive amounts (refunds / credits)', () => {
        const txs = [
            tx('2026-04-15', 'Apple Music', 29.9),  // refund — positive, ignored
            tx('2026-03-15', 'Apple Music', -19.9),
            tx('2026-02-15', 'Apple Music', -19.9),
            tx('2026-01-15', 'Apple Music', -19.9),
        ];
        // The refund is dropped, leaving 3 stable priors with no candidate latest.
        expect(detectPriceHikes(txs)).toEqual([]);
    });
});
