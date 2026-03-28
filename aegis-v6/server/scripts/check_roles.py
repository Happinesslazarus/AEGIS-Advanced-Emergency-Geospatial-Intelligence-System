import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    rows = await c.fetch("SELECT unnest(enum_range(NULL::citizen_role)) as val")
    print("Valid citizen_role values:")
    for r in rows:
        print(f"  {r['val']}")
    await c.close()

asyncio.run(main())
