const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Row counts for all major tables
    const tables = [
      'reports', 'alerts', 'historical_flood_events', 'ai_executions',
      'ai_model_metrics', 'flood_predictions', 'weather_observations',
      'image_analyses', 'fusion_computations', 'reporter_scores',
      'rag_documents', 'chat_sessions', 'chat_messages',
      'flood_zones', 'shelters', 'community_help',
      'operators', 'citizens', 'live_data_snapshots'
    ];
    console.log('=== DATABASE ROW COUNTS ===');
    for (const t of tables) {
      try {
        const r = await p.query(`SELECT COUNT(*) as c FROM ${t}`);
        console.log(`  ${t}: ${r.rows[0].c}`);
      } catch { console.log(`  ${t}: TABLE NOT FOUND`); }
    }

    // Check reports breakdown
    const r2 = await p.query("SELECT incident_category, severity, COUNT(*) as c FROM reports GROUP BY incident_category, severity ORDER BY c DESC LIMIT 10");
    console.log('\n=== REPORTS BREAKDOWN ===');
    r2.rows.forEach(r => console.log(`  ${r.incident_category}/${r.severity}: ${r.c}`));

    // Check if pgvector extension exists
    try {
      const r3 = await p.query("SELECT extname FROM pg_extension WHERE extname='vector'");
      console.log('\n=== PGVECTOR ===');
      console.log(r3.rows.length > 0 ? '  INSTALLED' : '  NOT INSTALLED');
    } catch { console.log('\n  pgvector check failed'); }

    // Check historical flood events
    const r4 = await p.query("SELECT area, event_date, severity FROM historical_flood_events ORDER BY event_date DESC LIMIT 5");
    console.log('\n=== HISTORICAL FLOOD EVENTS (latest 5) ===');
    r4.rows.forEach(r => console.log(`  ${r.area} - ${r.event_date} - ${r.severity}`));

    // Check ai_model_metrics
    const r5 = await p.query("SELECT model_name, model_version, accuracy FROM ai_model_metrics LIMIT 5");
    console.log('\n=== AI MODEL METRICS ===');
    r5.rows.forEach(r => console.log(`  ${r.model_name} ${r.model_version}: acc=${r.accuracy}`));

  } catch (e) { console.error(e.message); }
  finally { await p.end(); }
}
main();
