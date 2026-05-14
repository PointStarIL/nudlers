import fs from 'fs';
import path from 'path';

function walk(dir, results = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, results);
      else if (entry.name.endsWith('.js')) results.push(full);
    }
  } catch {}
  return results;
}

export default async function handler(req, res) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== 'true') return res.status(404).end();
  if (!process.env.DEV_TOKEN || req.headers['x-dev-token'] !== process.env.DEV_TOKEN) {
    return res.status(401).json({ error: 'missing or invalid x-dev-token' });
  }

  const action = req.method === 'GET' ? (req.query.action || 'grep') : (req.body?.action || 'write');

  try {
    if (action === 'walk-grep') {
      const root = req.query.root || '/app/node_modules/israeli-bank-scrapers/lib';
      const pattern = req.query.pattern;
      if (!pattern) return res.status(400).json({ error: 'pattern required' });
      const re = new RegExp(pattern);
      const files = walk(root);
      const matches = [];
      for (const f of files) {
        try {
          const content = fs.readFileSync(f, 'utf8');
          const lines = content.split('\n');
          lines.forEach((line, i) => {
            if (re.test(line)) matches.push({ file: f.replace(root, ''), n: i + 1, line: line.trim().slice(0, 200) });
          });
        } catch {}
      }
      return res.status(200).json({ totalFiles: files.length, matchCount: matches.length, matches });
    }
    if (action === 'read') {
      const p = req.query.path;
      const start = parseInt(req.query.start || '1', 10);
      const end = parseInt(req.query.end || '10000', 10);
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n');
      return res.status(200).json({
        path: p, totalLines: lines.length,
        lines: lines.slice(start - 1, end).map((line, i) => ({ n: start + i, line })),
      });
    }
    if (action === 'scrape') {
      const { decrypt } = await import('./utils/encryption');
      const { getDB } = await import('./db');
      const client = await getDB();
      try {
        const row = (await client.query(
          'SELECT username, password, bank_account_number FROM vendor_credentials WHERE id = $1',
          [req.body?.credentialId || 1],
        )).rows[0];
        if (!row) return res.status(404).json({ error: 'no creds' });
        const { createScraper } = await import('israeli-bank-scrapers');
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (req.body?.daysBack || 7));
        // Build credentials per body
        const overrides = req.body?.credentialsOverride || {};
        const usernameDb = decrypt(row.username);
        const passwordDb = decrypt(row.password);
        const credentials = {
          username: overrides.username || usernameDb,
          password: overrides.password || passwordDb,
          nationalID: overrides.nationalID || usernameDb, // default: use same ID as username
        };
        const scraper = createScraper({
          companyId: 'yahav', startDate, verbose: true, showBrowser: false,
          timeout: req.body?.timeout || 180000,
          defaultTimeout: req.body?.timeout || 180000,
        });
        const result = await scraper.scrape(credentials);
        return res.status(200).json({ ok: true, result, usedCredentials: {
          username: credentials.username, hasPass: !!credentials.password, nationalID: credentials.nationalID,
        }});
      } finally {
        client.release();
      }
    }
    // default: grep single file
    const p = req.query.path || '/app/node_modules/israeli-bank-scrapers/lib/scrapers/yahav.js';
    const term = req.query.grep || 'text';
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.split('\n');
    const matches = lines
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => line.includes(term));
    return res.status(200).json({ path: p, totalLines: lines.length, matches });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
