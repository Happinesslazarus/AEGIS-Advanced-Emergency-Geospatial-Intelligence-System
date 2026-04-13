"""
Module: find_users.py

Find_users utility script.

Simple explanation:
Standalone script for find_users.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    rows = await c.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%user%'")
    print("User tables:")
    for r in rows:
        print(f"  {r['tablename']}")
    
    # Try common variations
    for table in ['app_users', 'accounts', 'auth_users', 'citizens']:
        try:
            count = await c.fetchval(f"SELECT count(*) FROM {table}")
            print(f"\n{table}: {count} rows")
            if count > 0:
                sample = await c.fetchrow(f"SELECT * FROM {table} LIMIT 1")
                print(f"  Columns: {list(dict(sample).keys())}")
        except Exception:
            pass
    await c.close()

asyncio.run(main())
