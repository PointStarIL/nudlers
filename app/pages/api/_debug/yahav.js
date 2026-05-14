import fs from 'fs';

export default function handler(req, res) {
  try {
    const paths = [
      '/app/node_modules/israeli-bank-scrapers/lib/scrapers/yahav.js',
      '/app/.next/standalone/node_modules/israeli-bank-scrapers/lib/scrapers/yahav.js',
    ];
    const result = {};
    for (const p of paths) {
      try {
        const stat = fs.statSync(p);
        const content = fs.readFileSync(p, 'utf8');
        result[p] = {
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          hasFromPicker: content.includes('FROM_PICKER'),
          hasOldGridSelector: content.includes('.pmu-years'),
          hasAccountIdSelectorSingle: content.includes('ACCOUNT_ID_SELECTOR_SINGLE'),
          firstLines: content.split('\n').slice(0, 5).join('\n'),
        };
      } catch (e) {
        result[p] = { error: e.message };
      }
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
