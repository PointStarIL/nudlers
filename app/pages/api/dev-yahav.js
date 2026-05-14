import { getDB } from './db';
import { decrypt } from './utils/encryption';
import {
  prepareCredentials,
  getScraperOptions,
  runScraper,
  getScraperTimeout,
} from './utils/scraperUtils';

export default async function handler(req, res) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== 'true') return res.status(404).end();
  if (!process.env.DEV_TOKEN || req.headers['x-dev-token'] !== process.env.DEV_TOKEN) {
    return res.status(401).json({ error: 'missing or invalid x-dev-token' });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const { credentialId, daysBack = 7, mode = 'direct' } = req.body || {};
  if (!credentialId) return res.status(400).json({ error: 'credentialId required' });

  let client;
  try {
    client = await getDB();
    const row = (await client.query(
      'SELECT vendor, username, password, id_number, bank_account_number, nickname FROM vendor_credentials WHERE id = $1',
      [credentialId],
    )).rows[0];
    if (!row) return res.status(404).json({ error: 'credential not found' });
    if (row.vendor !== 'yahav') return res.status(400).json({ error: 'yahav-only endpoint' });

    const credentials = {
      username: decrypt(row.username),
      password: decrypt(row.password),
      num: row.bank_account_number,
      nickname: row.nickname,
    };

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    if (mode === 'wrapper') {
      const scraperCredentials = prepareCredentials('yahav', credentials);
      const timeoutSetting = await getScraperTimeout(client);
      const scraperOptions = {
        ...getScraperOptions('yahav', startDate, {
          timeout: timeoutSetting,
          showBrowser: false,
          fetchCategories: false,
        }),
        logRequests: false,
      };
      try {
        const result = await runScraper(client, scraperOptions, scraperCredentials, () => {}, () => false);
        return res.status(200).json({ ok: true, mode: 'wrapper', result });
      } catch (e) {
        return res.status(200).json({
          ok: false,
          mode: 'wrapper',
          name: e.name,
          message: e.message,
          stack: e.stack,
          cause: e.cause ? { message: e.cause.message, stack: e.cause.stack } : null,
        });
      }
    }

    const { createScraper } = await import('israeli-bank-scrapers');
    const scraper = createScraper({
      companyId: 'yahav',
      startDate,
      verbose: true,
      showBrowser: false,
      timeout: 180000,
      defaultTimeout: 180000,
    });
    const result = await scraper.scrape({
      username: credentials.username,
      password: credentials.password,
      nationalID: credentials.num,
    });
    return res.status(200).json({ ok: true, mode: 'direct', result });
  } catch (e) {
    return res.status(500).json({
      ok: false, name: e.name, message: e.message, stack: e.stack,
      cause: e.cause ? { message: e.cause.message, stack: e.cause.stack } : null,
    });
  } finally {
    if (client) client.release();
  }
}
