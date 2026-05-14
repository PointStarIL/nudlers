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

export default function handler(req, res) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== 'true') return res.status(404).end();
  if (!process.env.DEV_TOKEN || req.headers['x-dev-token'] !== process.env.DEV_TOKEN) {
    return res.status(401).json({ error: 'missing or invalid x-dev-token' });
  }
  const action = req.method === 'GET' ? (req.query.action || 'grep') : 'grep';
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
    return res.status(500).json({ error: e.message });
  }
}
