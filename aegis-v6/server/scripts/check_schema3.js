const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const r = await p.query(`
    SELECT column_name, character_maximum_length, data_type 
    FROM information_schema.columns 
    WHERE table_name='reports' AND character_maximum_length IS NOT NULL AND character_maximum_length < 100
    ORDER BY character_maximum_length
  `);
  console.log('Short varchar columns in reports:');
  r.rows.forEach(c => console.log(`  ${c.column_name}: varchar(${c.character_maximum_length})`));

  const r2 = await p.query(`
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns 
    WHERE table_name='historical_flood_events' 
    ORDER BY ordinal_position
  `);
  console.log('\nhistorical_flood_events columns:');
  r2.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}${c.character_maximum_length ? '(' + c.character_maximum_length + ')' : ''}`));
  
  await p.end();
})();
