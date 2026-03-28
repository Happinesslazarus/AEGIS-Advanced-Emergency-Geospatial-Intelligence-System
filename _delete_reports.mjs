import pg from 'pg';
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('./aegis-v6/server/.env','utf8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])
);
const c = new pg.Client({connectionString: env.DATABASE_URL});
await c.connect();
// Delete media first (FK), then reports
const m = await c.query('DELETE FROM report_media');
console.log('Deleted', m.rowCount, 'media rows');
const r = await c.query('DELETE FROM reports');
console.log('Deleted', r.rowCount, 'reports');
const count = await c.query('SELECT COUNT(*) FROM reports');
console.log('Reports remaining:', count.rows[0].count);
await c.end();
