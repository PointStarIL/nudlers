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
  const root = '/app/node_modules/israeli-bank-scrapers/lib';
  const files = walk(root);
  const matches = [];
  // Look for any 'text' iteration or spread
  const patterns = [
    /\bfor\s*\(\s*[^)]*\s+of\s+text\b/,
    /\.\.\.text\b/,
    /Array\.from\s*\(\s*text\b/,
    /\bof\s+text\)/,
  ];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        for (const p of patterns) {
          if (p.test(line)) {
            matches.push({ file: f.replace(root, ''), n: i + 1, line: line.trim().slice(0, 200) });
            break;
          }
        }
      });
    } catch {}
  }
  res.status(200).json({ totalFiles: files.length, matches });
}
