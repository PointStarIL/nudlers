import fs from 'fs';

export default function handler(req, res) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== 'true') return res.status(404).end();
  if (!process.env.DEV_TOKEN || req.headers['x-dev-token'] !== process.env.DEV_TOKEN) {
    return res.status(401).json({ error: 'missing or invalid x-dev-token' });
  }
  const { path: filePath, grep } = req.body || req.query || {};
  if (req.method === 'GET') {
    const p = req.query.path || '/app/node_modules/israeli-bank-scrapers/lib/scrapers/yahav.js';
    try {
      const content = fs.readFileSync(p, 'utf8');
      const term = req.query.grep || 'text';
      const lines = content.split('\n');
      const matches = lines
        .map((line, i) => ({ n: i + 1, line }))
        .filter(({ line }) => line.includes(term));
      return res.status(200).json({ path: p, totalLines: lines.length, matches });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  return res.status(405).end();
}
