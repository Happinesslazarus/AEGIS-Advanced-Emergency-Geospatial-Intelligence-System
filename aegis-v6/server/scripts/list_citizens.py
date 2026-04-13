"""
Module: list_citizens.py

List_citizens utility script.

Simple explanation:
Standalone script for list_citizens.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    rows = await c.fetch("SELECT id, email, display_name, role FROM citizens ORDER BY role, email LIMIT 10")
    for r in rows:
        print(f"  {r['email']} | role={r['role']} | name={r['display_name']}")
    await c.close()

asyncio.run(main())
