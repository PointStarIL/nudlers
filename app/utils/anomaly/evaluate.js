import { getDB } from '../../pages/api/db';
import logger from '../logger.js';
import { detectRecurringPayments } from '../recurringDetection';
import { detectPriceHikes } from './detectors/priceHike';
import { detectNewRecurring } from './detectors/newRecurring';
import { detectCategorySpikes } from './detectors/categorySpike';
import { normalizeMerchant } from './normalize';

// User-feedback suppression windows. The schema's status column has four
// values; only `normal` and `dismissed` mean "the user has seen this and
// signalled how to handle it." We honor both, with different durations:
//   normal     = "this is fine" — permanent suppression (the user
//                explicitly told us this isn't anomalous; respect that
//                until they manually re-open the row).
//   dismissed  = "I closed this" — soft 60-day suppression (probably just
//                inbox-clearing; OK to re-fire after that).
const DISMISSED_SUPPRESSION_DAYS = 60;

/**
 * Build the semantic key a user is implicitly labelling when they action
 * an anomaly. Distinct from the row's fingerprint (which is event-specific
 * and changes month-to-month) — this is what the *underlying merchant /
 * category* is, so we can match a labelled row from August against a fresh
 * detection in November.
 */
function semanticKey(type, payload) {
    if (!payload) return null;
    if (type === 'price_hike' || type === 'new_recurring') {
        const merchant = normalizeMerchant(payload.merchant);
        if (!merchant) return null;
        const account = payload.accountNumber ?? 'na';
        return `${type}|${merchant}|${account}`;
    }
    if (type === 'category_spike') {
        const cat = (payload.category ?? '').toString().toLowerCase().trim();
        if (!cat) return null;
        return `${type}|${cat}`;
    }
    return null;
}

/**
 * Pull every anomaly the user has labelled (normal/dismissed), bucketed by
 * semantic key + status. Detectors consult these buckets before inserting
 * to suppress repeat fires. Without this, the user could click "this is
 * normal" on an Apple iCloud price hike every month forever — the fingerprint
 * changes (different monthKey) and we'd happily refire.
 */
async function loadUserFeedback(client) {
    const result = await client.query(`
        SELECT type, payload, status, dismissed_at
        FROM anomalies
        WHERE status IN ('normal', 'dismissed')
    `);
    const normalKeys = new Set();
    const dismissedKeys = new Set();
    const suppressionCutoff = Date.now() - DISMISSED_SUPPRESSION_DAYS * 86400 * 1000;
    for (const row of result.rows) {
        const key = semanticKey(row.type, row.payload);
        if (!key) continue;
        if (row.status === 'normal') {
            normalKeys.add(key);
        } else if (row.status === 'dismissed') {
            const ts = row.dismissed_at ? new Date(row.dismissed_at).getTime() : 0;
            if (ts >= suppressionCutoff) dismissedKeys.add(key);
        }
    }
    return { normalKeys, dismissedKeys };
}

/**
 * Run every detector against the latest transaction history and UPSERT the
 * results into `anomalies`. Idempotent: a second run within a few minutes
 * produces the same fingerprints and updates the existing rows in-place
 * rather than creating duplicates.
 *
 * Returns a summary object: { detected, inserted, updated } — useful for
 * the manual /api/anomalies/evaluate trigger and for logs.
 */
export async function evaluateAnomalies() {
    const client = await getDB();
    let inserted = 0;
    let updated = 0;
    let suppressed = 0;
    const detected = [];

    try {
        const feedback = await loadUserFeedback(client);
        // Pull a window of transactions wide enough for each detector:
        //  - priceHike + newRecurring need ~6 months of recurring history
        //  - categorySpike needs trailing 12 weeks
        // 270 days covers both with a comfortable margin.
        const txResult = await client.query(`
            SELECT identifier, vendor, name, price, category, account_number,
                   date, processed_date, transaction_type,
                   installments_number, installments_total
            FROM transactions
            WHERE date >= CURRENT_DATE - INTERVAL '270 days'
        `);
        const transactions = txResult.rows.map((r) => ({
            identifier: r.identifier,
            vendor: r.vendor,
            name: r.name,
            price: typeof r.price === 'number' ? r.price : Number(r.price),
            category: r.category,
            account_number: r.account_number,
            date: r.date,
            processed_date: r.processed_date,
            transaction_type: r.transaction_type,
            installments_number: r.installments_number,
            installments_total: r.installments_total,
        }));

        // priceHike runs directly on the transaction stream so it can see
        // across the recurring detector's amount-clustering boundary
        // (a hike literally moves a charge into a different cluster).
        const priceHikes = detectPriceHikes(
            transactions.map((t) => ({
                name: t.name,
                price: t.price,
                account_number: t.account_number,
                date: t.date,
            })),
        );
        detected.push(...priceHikes);

        // newRecurring leverages the existing recurring pattern detection.
        // Suppress merchants that already fired a priceHike: when a sub
        // hikes, the cheap-history cluster has 3 charges and looks like a
        // "new recurring", but it isn't — priceHike is the accurate framing.
        const hikedMerchants = new Set(
            priceHikes.map((a) => `${(a.payload.merchant || '').toString().toLowerCase().trim()}|${a.payload.accountNumber ?? 'na'}`),
        );
        // Strip Israeli installment-plan charges (תשלומים) before clustering.
        // A fridge bought in 6 monthly installments has the same amount each
        // month and looks like a fresh ₪200/mo subscription by month 2 — but
        // it's bounded and the user already knows about it. We keep them in
        // the priceHike + categorySpike paths because their amounts are
        // legitimately part of those signals.
        const nonInstallmentTx = transactions.filter(
            (t) => !t.installments_total || Number(t.installments_total) <= 1,
        );
        const recurring = detectRecurringPayments(nonInstallmentTx);
        for (const a of detectNewRecurring(recurring)) {
            const key = `${(a.payload.merchant || '').toString().toLowerCase().trim()}|${a.payload.accountNumber ?? 'na'}`;
            if (hikedMerchants.has(key)) continue;
            detected.push(a);
        }

        detected.push(...detectCategorySpikes(
            transactions.map((t) => ({ category: t.category, amount: t.price, date: t.date })),
        ));

        for (const a of detected) {
            // Honor the user-feedback signal. Without this gate, the same
            // merchant the user has marked "this is normal" gets re-flagged
            // every month with a fresh fingerprint — the single biggest
            // reason Insights felt dumb before.
            const key = semanticKey(a.type, a.payload);
            if (key && (feedback.normalKeys.has(key) || feedback.dismissedKeys.has(key))) {
                suppressed++;
                continue;
            }

            const result = await client.query(
                `INSERT INTO anomalies (type, severity, fingerprint, title, body, payload, related_transaction_keys, status)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'open')
                 ON CONFLICT (fingerprint) DO UPDATE SET
                    severity = EXCLUDED.severity,
                    title    = EXCLUDED.title,
                    body     = EXCLUDED.body,
                    payload  = EXCLUDED.payload,
                    updated_at = CURRENT_TIMESTAMP
                 RETURNING (xmax = 0) AS was_inserted`,
                [
                    a.type,
                    a.severity,
                    a.fingerprint,
                    a.title,
                    a.body,
                    JSON.stringify(a.payload ?? {}),
                    a.relatedTransactionKeys ?? [],
                ],
            );
            if (result.rows[0]?.was_inserted) inserted++;
            else updated++;
        }

        logger.info(
            { detected: detected.length, inserted, updated, suppressed },
            '[anomalies] Evaluation complete',
        );
        return { detected: detected.length, inserted, updated, suppressed };
    } catch (err) {
        logger.error({ err: err.message }, '[anomalies] Evaluation failed');
        throw err;
    } finally {
        client.release();
    }
}
