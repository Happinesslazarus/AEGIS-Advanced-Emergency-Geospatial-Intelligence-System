const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const r = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='reports' ORDER BY ordinal_position");
    console.log('=== REPORTS COLUMNS ===');
    r.rows.forEach(c => console.log(c.column_name + ':' + c.data_type));
  } catch(e) { console.log('ERR:' + e.message); }

  try {
    const r2 = await pool.query("SELECT unnest(enum_range(NULL::report_severity))::text as v");
    console.log('\nseverity_enum: ' + r2.rows.map(r => r.v).join(', '));
  } catch(e) { console.log('enum err: ' + e.message); }

  try {
    const r3 = await pool.query("SELECT unnest(enum_range(NULL::report_status))::text as v");
    console.log('status_enum: ' + r3.rows.map(r => r.v).join(', '));
  } catch(e) { console.log('status enum err: ' + e.message); }

  //Check reporter_scores table
  try {
    const r4 = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='reporter_scores' ORDER BY ordinal_position");
    console.log('\n=== REPORTER_SCORES COLUMNS ===');
    r4.rows.forEach(c => console.log(c.column_name + ':' + c.data_type));
  } catch(e) { console.log('reporter_scores: ' + e.message); }

  await pool.end();
})();
