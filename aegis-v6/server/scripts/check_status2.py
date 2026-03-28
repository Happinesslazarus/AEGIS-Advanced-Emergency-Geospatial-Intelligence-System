import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    rows = await c.fetch("""
        SELECT status, count(*) as cnt
        FROM reports WHERE deleted_at IS NULL
        GROUP BY status ORDER BY cnt DESC
    """)
    for r in rows:
        print(f"  {r['status']}: {r['cnt']}")
    
    # Check enum values
    enums = await c.fetch("SELECT unnest(enum_range(NULL::report_status)) as val")
    print("\nValid status enum values:")
    for e in enums:
        print(f"  {e['val']}")
    await c.close()

asyncio.run(main())
