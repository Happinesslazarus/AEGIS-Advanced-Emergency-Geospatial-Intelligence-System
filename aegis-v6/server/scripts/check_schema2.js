const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres:Happylove%40%21@localhost:5432/aegis' });

(async () => {
  const r = await p.query(`
    SELECT column_name, data_type, is_nullable, column_default, generation_expression 
    FROM information_schema.columns 
    WHERE table_name='fusion_computations' 
    ORDER BY ordinal_position
  `);
  console.log('fusion_computations columns:');
  r.rows.forEach(c => console.log(`  ${c.column_name} (${c.data_type}, null:${c.is_nullable}, default:${c.column_default})`));

  const r2 = await p.query(`
    SELECT column_name, generation_expression 
    FROM information_schema.columns 
    WHERE table_name='reports' AND generation_expression IS NOT NULL
  `);
  console.log('\nGenerated columns in reports:');
  r2.rows.forEach(c => console.log(`  ${c.column_name}: ${c.generation_expression}`));
  
  await p.end();
})();
