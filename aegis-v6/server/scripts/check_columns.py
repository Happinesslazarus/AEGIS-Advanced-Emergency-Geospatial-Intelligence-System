"""
Module: check_columns.py

Check_columns utility script.

Simple explanation:
Standalone script for check_columns.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    rows = await c.fetch("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'reports' 
        AND column_name IN ('incident_category', 'incident_type', 'severity', 'display_type', 'incident_subtype')
        ORDER BY column_name
    """)
    for r in rows:
        print(f"  {r['column_name']}: {r['data_type']}")
    
    # Check a sample row
    sample = await c.fetchrow("SELECT incident_category, incident_type, display_type, severity, incident_subtype FROM reports LIMIT 1")
    if sample:
        print("\nSample row:")
        for k, v in dict(sample).items():
            print(f"  {k}: {v}")
    await c.close()

asyncio.run(main())
