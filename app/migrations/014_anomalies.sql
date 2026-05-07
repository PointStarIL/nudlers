-- Migration: Anomaly insights — flagged events worth the user's attention.
--
-- Each row is one anomaly event detected by a detector run. The fingerprint
-- column makes the table idempotent: a second detector run for the same
-- underlying event (same merchant, same hike, same week) UPSERTs onto the
-- existing row instead of duplicating. This is what lets us run the daily
-- evaluator over and over without spamming the user.
--
-- Status transitions (one-way): open → acknowledged | dismissed | normal.
-- - acknowledged: user has seen it, no further action expected
-- - dismissed:    user explicitly closed it (just clear it from the inbox)
-- - normal:       user confirmed "this is fine" — strong signal we should
--                 also avoid re-flagging similar future events; detector code
--                 is responsible for honoring this where it makes sense.

CREATE TABLE IF NOT EXISTS anomalies (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,                                 -- 'price_hike' | 'new_recurring' | 'category_spike'
    severity TEXT NOT NULL,                             -- 'low' | 'medium' | 'high'
    fingerprint TEXT NOT NULL UNIQUE,                   -- dedup key; format owned by each detector
    title TEXT NOT NULL,                                -- short, ready-to-display
    body TEXT,                                          -- longer human-readable explanation
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,         -- structured details (amounts, dates, ids…)
    -- "identifier:vendor" composite keys (transactions has no plain id column).
    -- Useful for detectors that name specific transactions; nullable / empty
    -- for detectors that filter by category+week instead.
    related_transaction_keys TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    dismissed_at TIMESTAMP,
    CHECK (severity IN ('low', 'medium', 'high')),
    CHECK (status IN ('open', 'acknowledged', 'dismissed', 'normal')),
    CHECK (type IN ('price_hike', 'new_recurring', 'category_spike'))
);

-- The hot read path: "show me everything still in my inbox, newest first."
CREATE INDEX IF NOT EXISTS idx_anomalies_status_created
    ON anomalies (status, created_at DESC);

-- For the WhatsApp digest: anomalies opened in the last 24h.
CREATE INDEX IF NOT EXISTS idx_anomalies_created
    ON anomalies (created_at DESC)
    WHERE status = 'open';
