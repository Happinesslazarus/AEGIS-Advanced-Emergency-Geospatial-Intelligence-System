const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const client = await pool.connect();
  try {
    // 1. Add 'critical' to severity enum
    try {
      await client.query("ALTER TYPE report_severity ADD VALUE IF NOT EXISTS 'critical'");
      console.log('OK: Added critical to severity enum');
    } catch (e) {
      console.log('Severity enum:', e.message);
    }

    // 2. Create weather_observations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS weather_observations (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        location_name VARCHAR(100),
        latitude FLOAT NOT NULL,
        longitude FLOAT NOT NULL,
        temperature_c FLOAT,
        rainfall_mm FLOAT,
        humidity_percent FLOAT,
        wind_speed_ms FLOAT,
        pressure_hpa FLOAT,
        source VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(timestamp, latitude, longitude)
      )
    `);
    console.log('OK: weather_observations table');

    // 3. Create llm_feedback table
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID,
        message_id UUID,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        feedback_text TEXT,
        model_name VARCHAR(100),
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('OK: llm_feedback table');

    // 4. Create llm_pending_finetune table
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_pending_finetune (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        prompt TEXT NOT NULL,
        completion TEXT NOT NULL,
        source VARCHAR(50),
        quality_score FLOAT,
        used_in_finetune BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('OK: llm_pending_finetune table');

    // 5. Verify tables
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('weather_observations', 'llm_feedback', 'llm_pending_finetune')
      ORDER BY table_name
    `);
    console.log('Verified tables:', rows.map(r => r.table_name).join(', '));

    // 6. Verify severity enum
    const enumResult = await client.query(`
      SELECT unnest(enum_range(NULL::report_severity))::text AS val
    `);
    console.log('Severity enum values:', enumResult.rows.map(r => r.val).join(', '));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
