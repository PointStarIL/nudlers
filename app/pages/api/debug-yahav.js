import fs from 'fs';

export default function handler(req, res) {
  const p = '/app/node_modules/israeli-bank-scrapers/lib/scrapers/yahav.js';
  try {
    const content = fs.readFileSync(p, 'utf8');
    // Find lines that mention "text" anywhere
    const lines = content.split('\n');
    const textLines = lines
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => /\btext\b/.test(line));
    res.status(200).json({
      size: content.length,
      totalLines: lines.length,
      textOccurrences: textLines,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
