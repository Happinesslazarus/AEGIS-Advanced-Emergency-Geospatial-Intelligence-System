"""
Module: check_status2.py

Check_status2 utility script.

Simple explanation:
Standalone script for check_status2.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    rows = await c.fetch("""
        SELECT status, count(*) as cnt
        FROM reports WHERE deleted_at IS NULL
        GROUP BY status ORDER BY cnt DESC
    """)
    for r in rows:
        print(f"  {r['status']}: {r['cnt']}")
    
    # Check enum values
    enums = await c.fetch("SELECT unnest(enum_range(NULL::report_status)) as val")
    print("\nValid status enum values:")
    for e in enums:
        print(f"  {e['val']}")
    await c.close()

asyncio.run(main())
