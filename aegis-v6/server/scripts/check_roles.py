"""
Module: check_roles.py

Check_roles utility script.

Simple explanation:
Standalone script for check_roles.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    rows = await c.fetch("SELECT unnest(enum_range(NULL::citizen_role)) as val")
    print("Valid citizen_role values:")
    for r in rows:
        print(f"  {r['val']}")
    await c.close()

asyncio.run(main())
