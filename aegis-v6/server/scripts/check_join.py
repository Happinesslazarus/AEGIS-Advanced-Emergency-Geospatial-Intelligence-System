"""
Module: check_join.py

Check_join utility script.

Simple explanation:
Standalone script for check_join.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    print('sample rs:', await c.fetchrow('SELECT reporter_id, ip_hash FROM reporter_scores LIMIT 1'))
    print('sample r:', await c.fetchrow('SELECT reporter_ip, reporter_id FROM reports LIMIT 1'))
    # Check if reporter_ip matches ip_hash
    print('match count:', await c.fetchval(
        'SELECT count(*) FROM reports r JOIN reporter_scores rs ON rs.ip_hash = r.reporter_ip'
    ))
    print('match reporter_id:', await c.fetchval(
        'SELECT count(*) FROM reports r JOIN reporter_scores rs ON rs.reporter_id = r.reporter_ip'
    ))
    await c.close()

asyncio.run(main())
