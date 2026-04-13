"""
Module: check_operators.py

Check_operators utility script.

Simple explanation:
Standalone script for check_operators.
"""

import os
import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    
    # Check operators table columns
    rows = await c.fetch("""
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'operators'
        ORDER BY ordinal_position
    """)
    print("Operators table columns:")
    for r in rows:
        print(f"  {r['column_name']}: {r['data_type']} {'NULL' if r['is_nullable']=='YES' else 'NOT NULL'} default={r['column_default']}")
    
    # Check constraints
    constraints = await c.fetch("""
        SELECT constraint_name, constraint_type 
        FROM information_schema.table_constraints 
        WHERE table_name = 'operators'
    """)
    print("\nConstraints:")
    for r in constraints:
        print(f"  {r['constraint_name']}: {r['constraint_type']}")
    
    await c.close()

asyncio.run(main())
