import { getDB } from './db';
import { decrypt } from './utils/encryption';
import { createScraper } from 'israeli-bank-scrapers';

export default async function handler(req, res) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== 'true') return res.status(404).end();
  if (!process.env.DEV_TOKEN || req.headers['x-dev-token'] !== process.env.DEV_TOKEN) {
    return res.status(401).json({ error: 'missing or invalid x-dev-token' });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const { credentialId, daysBack = 7 } = req.body || {};
  if (!credentialId) return res.status(400).json({ error: 'credentialId required' });

  let client;
  try {
    client = await getDB();
    const row = (await client.query(
      'SELECT vendor, username, password, id_number, bank_account_number FROM vendor_credentials WHERE id = $1',
      [credentialId],
    )).rows[0];
    if (!row) return res.status(404).json({ error: 'credential not found' });
    if (row.vendor !== 'yahav') return res.status(400).json({ error: 'yahav-only endpoint' });

    const username = decrypt(row.username);
    const password = decrypt(row.password);
    const nationalID = row.bank_account_number;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const scraper = createScraper({ companyId: 'yahav', startDate, verbose: true, showBrowser: false });
    const result = await scraper.scrape({ username, password, nationalID });
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({
      ok: false, name: e.name, message: e.message, stack: e.stack,
      cause: e.cause ? { message: e.cause.message, stack: e.cause.stack } : null,
    });
  } finally {
    if (client) client.release();
  }
}
