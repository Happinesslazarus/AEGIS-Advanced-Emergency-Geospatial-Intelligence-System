import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    
    # Check ai_model_metrics columns
    rows = await c.fetch("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'ai_model_metrics'
        ORDER BY ordinal_position
    """)
    print("ai_model_metrics columns:")
    for r in rows:
        print(f"  {r['column_name']}: {r['data_type']}")
    
    # Check reporter_scores columns
    rows2 = await c.fetch("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'reporter_scores'
        ORDER BY ordinal_position
    """)
    print("\nreporter_scores columns:")
    for r in rows2:
        print(f"  {r['column_name']}: {r['data_type']}")
    
    await c.close()

asyncio.run(main())
