import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    
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
