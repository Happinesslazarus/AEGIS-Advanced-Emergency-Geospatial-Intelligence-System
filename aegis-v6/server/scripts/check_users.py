"""
Module: check_users.py

Check_users utility script.

Simple explanation:
Standalone script for check_users.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    rows = await c.fetch("SELECT id, email, name, role FROM users ORDER BY role, email LIMIT 20")
    for r in rows:
        print(f"  {r['email']} | role={r['role']} | name={r['name']} | id={r['id']}")
    await c.close()

asyncio.run(main())
