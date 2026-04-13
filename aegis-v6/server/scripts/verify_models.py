"""
Module: verify_models.py

Verify_models utility script.

Simple explanation:
Standalone script for verify_models.
"""

import asyncio, asyncpg

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    
    # Check ai_model_metrics
    rows = await c.fetch('SELECT model_name, model_version, metric_name, metric_value, dataset_size FROM ai_model_metrics ORDER BY created_at DESC')
    print("=== AI MODEL METRICS ===")
    for r in rows:
        mn = r['model_name'] or ''
        mv = r['model_version'] or ''
        metn = r['metric_name'] or ''
        ds = r['dataset_size']
        print(f"  {mn:30s} {mv:30s} {metn:20s} ds={ds}")
    
    # Check model_registry dir
    import os
    reg = r'e:\aegis-v6-fullstack\aegis-v6\ai-engine\model_registry'
    print(f"\n=== MODEL REGISTRY FILES ===")
    for root, dirs, files in os.walk(reg):
        for f in files:
            fp = os.path.join(root, f)
            size = os.path.getsize(fp)
            rel = os.path.relpath(fp, reg)
            print(f"  {rel:60s} {size:>10,} bytes")
    
    await c.close()

asyncio.run(main())
