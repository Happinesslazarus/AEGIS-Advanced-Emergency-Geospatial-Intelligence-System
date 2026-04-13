"""
Module: fix_schema3.py

Fix_schema3 utility script.

Simple explanation:
Standalone script for fix_schema3.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    await c.execute("ALTER TABLE ai_model_metrics ALTER COLUMN model_version TYPE varchar(100)")
    print("Widened model_version to varchar(100)")
    await c.close()

asyncio.run(main())
