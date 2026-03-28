import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    rows = await c.fetch("SELECT id, email, display_name, role FROM citizens ORDER BY role, email LIMIT 10")
    for r in rows:
        print(f"  {r['email']} | role={r['role']} | name={r['display_name']}")
    await c.close()

asyncio.run(main())
