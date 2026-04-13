"""
Module: check_status_counts.py

Check_status_counts utility script.

Simple explanation:
Standalone script for check_status_counts.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    row = await c.fetchrow("""
        SELECT 
            count(*) as total,
            count(*) FILTER (WHERE status IN ('verified', 'resolved')) as verified_resolved,
            count(*) FILTER (WHERE status = 'pending') as pending,
            count(*) FILTER (WHERE status = 'urgent') as urgent
        FROM reports WHERE deleted_at IS NULL
    """)
    for k, v in dict(row).items():
        print(f"  {k}: {v}")
    await c.close()

asyncio.run(main())
