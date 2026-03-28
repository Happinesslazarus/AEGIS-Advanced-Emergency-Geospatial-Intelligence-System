import asyncio, asyncpg

async def main():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    await c.execute("ALTER TABLE ai_model_metrics ALTER COLUMN model_version TYPE varchar(100)")
    print("Widened model_version to varchar(100)")
    await c.close()

asyncio.run(main())
