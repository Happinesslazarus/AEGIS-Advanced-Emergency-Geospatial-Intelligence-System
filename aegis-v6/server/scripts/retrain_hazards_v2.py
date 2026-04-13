"""
Module: retrain_hazards_v2.py

Retrain_hazards_v2 utility script.

Simple explanation:
Standalone script for retrain_hazards_v2.
"""
import asyncio
import sys
import os
import time
import warnings
warnings.filterwarnings('ignore')

sys.path.insert(0, r'e:\aegis-v6-fullstack\aegis-v6\ai-engine')
os.chdir(r'e:\aegis-v6-fullstack\aegis-v6\ai-engine')

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

async def train_hazard(hazard_type: str):
    from app.training.training_pipeline import TrainingPipeline
    from datetime import datetime, timedelta
    import asyncpg
    
    print(f"\n{'='*60}")
    print(f"  TRAINING: {hazard_type.upper()}")
    print(f"{'='*60}")
    
    start = time.time()
    pipeline = TrainingPipeline("config.yaml")
    pipeline.data_loader.db_pool = await asyncpg.create_pool(
        dsn=DB_URL, min_size=2, max_size=5, command_timeout=60
    )
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    
    try:
        result = await pipeline.train_model(
            hazard_type=hazard_type,
            model_type='xgboost',
            start_date=start_date,
            end_date=end_date,
            tune_hyperparams=False,
            save_model=True,
        )
        
        elapsed = time.time() - start
        print(f"\n  {hazard_type} Result:")
        print(f"    Status: {result.get('status', 'unknown')}")
        print(f"    Accuracy: {result.get('accuracy', 'N/A')}")
        if 'metrics' in result:
            for k, v in result['metrics'].items():
                if isinstance(v, (int, float)):
                    print(f"    {k}: {v:.4f}" if isinstance(v, float) else f"    {k}: {v}")
        if 'model_path' in result:
            print(f"    Saved: {result['model_path']}")
        print(f"    Time: {elapsed:.1f}s")
        return result
        
    except Exception as e:
        print(f"\n  FAILED: {hazard_type} - {e}")
        import traceback
        traceback.print_exc()
        return {'status': 'failed', 'error': str(e)}
    finally:
        if pipeline.data_loader.db_pool:
            await pipeline.data_loader.db_pool.close()

async def main():
    print("AEGIS Hazard Retraining with REAL Weather Data")
    print("=" * 60)
    
    results = {}
    for hazard in ['flood', 'drought', 'heatwave']:
        results[hazard] = await train_hazard(hazard)
    
    print(f"\n\n{'='*60}")
    print("  FINAL SUMMARY")
    print(f"{'='*60}")
    for h, r in results.items():
        s = r.get('status', '?')
        a = r.get('accuracy', 'N/A')
        if isinstance(a, float):
            a = f"{a*100:.1f}%" if a <= 1 else f"{a:.1f}%"
        print(f"  {h:15s} {s:10s} {a}")

asyncio.run(main())
