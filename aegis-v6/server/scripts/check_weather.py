import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    cols = await c.fetch("SELECT column_name FROM information_schema.columns WHERE table_name='weather_observations' ORDER BY ordinal_position")
    print("WEATHER COLUMNS:")
    for r in cols:
        print(f"  {r['column_name']}")
    
    cnt = await c.fetchval("SELECT COUNT(*) FROM weather_observations")
    print(f"\nTotal rows: {cnt}")
    
    sample = await c.fetchrow("SELECT * FROM weather_observations LIMIT 1")
    print(f"\nSample row:")
    for k, v in dict(sample).items():
        print(f"  {k}: {v}")
    await c.close()

asyncio.run(main())
