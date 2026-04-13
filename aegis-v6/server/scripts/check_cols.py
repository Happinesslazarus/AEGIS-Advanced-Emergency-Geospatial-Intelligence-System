"""
Module: check_cols.py

Check_cols utility script.

Simple explanation:
Standalone script for check_cols.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    
    # Check reports columns
    cols = await c.fetch("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name='reports' ORDER BY ordinal_position")
    print("=== REPORTS COLUMNS ===")
    for r in cols:
        print(f"  {r['column_name']}: {r['data_type']}({r['character_maximum_length']})")
    
    # Check ai_model_metrics columns
    cols2 = await c.fetch("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name='ai_model_metrics' ORDER BY ordinal_position")
    print("\n=== AI_MODEL_METRICS COLUMNS ===")
    for r in cols2:
        print(f"  {r['column_name']}: {r['data_type']}({r['character_maximum_length']})")
    
    await c.close()

asyncio.run(main())
