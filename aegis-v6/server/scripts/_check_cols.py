import asyncio, asyncpg
async def f():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    r = await c.fetch("SELECT DISTINCT display_type FROM reports LIMIT 10")
    print("display_type values:", [x[0] for x in r])
    r2 = await c.fetch("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_name='reports' AND is_nullable='NO' AND column_default IS NULL ORDER BY ordinal_position")
    print("NOT NULL no-default columns:")
    for x in r2:
        print(f"  {x[0]:30s} {x[1]:20s}")
    await c.close()
asyncio.run(f())
