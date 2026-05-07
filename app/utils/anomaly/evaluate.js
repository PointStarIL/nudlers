import { getDB } from '../../pages/api/db';
import logger from '../logger.js';
import { detectRecurringPayments } from '../recurringDetection';
import { detectPriceHikes } from './detectors/priceHike';
import { detectNewRecurring } from './detectors/newRecurring';
import { detectCategorySpikes } from './detectors/categorySpike';

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
    const detected = [];

    try {
        // Pull a window of transactions wide enough for each detector:
        //  - priceHike + newRecurring need ~6 months of recurring history
        //  - categorySpike needs trailing 12 weeks
        // 270 days covers both with a comfortable margin.
        const txResult = await client.query(`
            SELECT identifier, vendor, name, price, category, account_number,
                   date, processed_date, transaction_type
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
        const recurring = detectRecurringPayments(transactions);
        for (const a of detectNewRecurring(recurring)) {
            const key = `${(a.payload.merchant || '').toString().toLowerCase().trim()}|${a.payload.accountNumber ?? 'na'}`;
            if (hikedMerchants.has(key)) continue;
            detected.push(a);
        }

        detected.push(...detectCategorySpikes(
            transactions.map((t) => ({ category: t.category, amount: t.price, date: t.date })),
        ));

        for (const a of detected) {
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
            { detected: detected.length, inserted, updated },
            '[anomalies] Evaluation complete',
        );
        return { detected: detected.length, inserted, updated };
    } catch (err) {
        logger.error({ err: err.message }, '[anomalies] Evaluation failed');
        throw err;
    } finally {
        client.release();
    }
}
