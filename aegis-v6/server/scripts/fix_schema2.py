"""
Module: fix_schema2.py

Fix_schema2 utility script.

Simple explanation:
Standalone script for fix_schema2.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    
    # 1. Add missing columns to ai_model_metrics
    alterations = [
        "ALTER TABLE ai_model_metrics ADD COLUMN IF NOT EXISTS metric_name varchar(100)",
        "ALTER TABLE ai_model_metrics ADD COLUMN IF NOT EXISTS metric_value double precision",
        "ALTER TABLE ai_model_metrics ADD COLUMN IF NOT EXISTS dataset_size integer",
        "ALTER TABLE ai_model_metrics ADD COLUMN IF NOT EXISTS metadata jsonb",
    ]
    
    for sql in alterations:
        try:
            await c.execute(sql)
            col = sql.split("IF NOT EXISTS ")[1].split(" ")[0]
            print(f"  Added column: {col}")
        except Exception as e:
            print(f"  Skip: {e}")
    
    # 2. Check reporter_scores - we need to fix the JOIN
    # The code does: rs.reporter_id = r.user_id
    # But reporter_scores has fingerprint_hash and ip_hash, not reporter_id
    # Check if reports has user_id
    has_user_id = await c.fetchval("""
        SELECT count(*) FROM information_schema.columns 
        WHERE table_name = 'reports' AND column_name = 'user_id'
    """)
    print(f"\n  reports.user_id exists: {has_user_id > 0}")
    
    # Check if reports has reporter_ip
    has_reporter_ip = await c.fetchval("""
        SELECT count(*) FROM information_schema.columns 
        WHERE table_name = 'reports' AND column_name = 'reporter_ip'
    """)
    print(f"  reports.reporter_ip exists: {has_reporter_ip > 0}")
    
    # Add reporter_id to reporter_scores as alias for ip_hash
    try:
        await c.execute("ALTER TABLE reporter_scores ADD COLUMN IF NOT EXISTS reporter_id varchar(255)")
        print("  Added reporter_scores.reporter_id")
    except Exception as e:
        print(f"  reporter_id skip: {e}")
    
    # Populate reporter_id from ip_hash
    await c.execute("UPDATE reporter_scores SET reporter_id = ip_hash WHERE reporter_id IS NULL")
    print("  Populated reporter_id from ip_hash")
    
    # Check if reports has user_id column (needed for the JOIN)
    if not has_user_id:
        # Check what reports columns could map to a user
        cols = await c.fetch("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'reports' AND column_name LIKE '%user%' OR column_name LIKE '%reporter%'
        """)
        print(f"\n  Reports user/reporter columns: {[r['column_name'] for r in cols]}")
    
    print("\nDone!")
    await c.close()

asyncio.run(main())
