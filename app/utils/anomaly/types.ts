/**
 * Shared types for the anomaly subsystem.
 *
 * A detector takes some input (transactions, recurring patterns…) and returns
 * a list of `DetectedAnomaly` candidates. The evaluator then upserts these
 * into the `anomalies` table, keyed on `fingerprint` to prevent double-flagging.
 *
 * Each detector owns its fingerprint format. Two principles to keep in mind:
 *  1. Same underlying event must produce the same fingerprint across runs
 *     (that's what makes the table idempotent).
 *  2. Different events must produce different fingerprints (otherwise we'd
 *     hide real anomalies under stale ones).
 *
 * Severity guidance:
 *  - high   — user almost certainly wants to see this (price hike, big new
 *             recurring charge). Surfaced in the WhatsApp daily summary.
 *  - medium — interesting but not urgent. Surfaced in WhatsApp summary too.
 *  - low    — borderline; in-app only.
 */

export type AnomalyType = 'price_hike' | 'new_recurring' | 'category_spike';
export type AnomalySeverity = 'low' | 'medium' | 'high';
export type AnomalyStatus = 'open' | 'acknowledged' | 'dismissed' | 'normal';

export interface DetectedAnomaly {
    type: AnomalyType;
    severity: AnomalySeverity;
    fingerprint: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    /**
     * Optional list of "identifier:vendor" composite keys for transactions
     * involved in this anomaly. Detectors that work on aggregates (e.g.
     * categorySpike) can leave this empty — the UI will reconstruct the
     * "review" filter from `payload` instead.
     */
    relatedTransactionKeys?: string[];
}
