import pg from 'pg';
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('./aegis-v6/server/.env','utf8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])
);
const c = new pg.Client({connectionString: env.DATABASE_URL});
await c.connect();
const r1 = await c.query('SELECT COUNT(*) FROM reports');
console.log('Total reports:', r1.rows[0].count);
const r2 = await c.query('SELECT report_number, created_at FROM reports ORDER BY created_at DESC');
const idx = r2.rows.findIndex(r => r.report_number === 'RPT-19D34A60ECA-AE2F');
console.log('Photo report position (1-indexed desc):', idx+1, '  page:', Math.ceil((idx+1)/20));
await c.end();
