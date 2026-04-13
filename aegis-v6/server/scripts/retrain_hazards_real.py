"""
Module: retrain_hazards_real.py

Retrain_hazards_real utility script.

Simple explanation:
Standalone script for retrain_hazards_real.
"""
import asyncio
import sys
import os
import time
import warnings
warnings.filterwarnings('ignore')

# Add AI engine to path
sys.path.insert(0, r'e:\aegis-v6-fullstack\aegis-v6\ai-engine')
os.chdir(r'e:\aegis-v6-fullstack\aegis-v6\ai-engine')

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

async def train_hazard(hazard_type: str):
    """Train a single hazard model."""
    from app.training.training_pipeline import TrainingPipeline
    from datetime import datetime, timedelta
    
    print(f"\n{'='*60}")
    print(f"  TRAINING: {hazard_type.upper()} model")
    print(f"{'='*60}")
    
    start = time.time()
    
    pipeline = TrainingPipeline("config.yaml")
    pipeline.data_loader.db_pool = None
    
    import asyncpg
    pipeline.data_loader.db_pool = await asyncpg.create_pool(
        dsn=DB_URL, min_size=2, max_size=5, command_timeout=60
    )
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    
    try:
        result = await pipeline.train_model(
            hazard_type=hazard_type,
            model_type='xgboost',
            date_range=(start_date, end_date)
        )
        
        elapsed = time.time() - start
        print(f"\n  Result for {hazard_type}:")
        print(f"    Status: {result.get('status', 'unknown')}")
        print(f"    Accuracy: {result.get('accuracy', 'N/A')}")
        if 'metrics' in result:
            for k, v in result['metrics'].items():
                if isinstance(v, float):
                    print(f"    {k}: {v:.4f}")
                else:
                    print(f"    {k}: {v}")
        if 'model_path' in result:
            print(f"    Saved to: {result['model_path']}")
        print(f"    Time: {elapsed:.1f}s")
        
        return result
        
    except Exception as e:
        elapsed = time.time() - start
        print(f"\n  FAILED: {hazard_type} - {e}")
        import traceback
        traceback.print_exc()
        return {'status': 'failed', 'error': str(e), 'time': elapsed}
    finally:
        if pipeline.data_loader.db_pool:
            await pipeline.data_loader.db_pool.close()

async def main():
    print("AEGIS Hazard Model Retraining with REAL Weather Data")
    print("=" * 60)
    
    results = {}
    for hazard in ['flood', 'drought', 'heatwave']:
        results[hazard] = await train_hazard(hazard)
    
    print(f"\n\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    for hazard, result in results.items():
        status = result.get('status', 'unknown')
        acc = result.get('accuracy', 'N/A')
        if isinstance(acc, float):
            acc = f"{acc*100:.1f}%" if acc <= 1 else f"{acc:.1f}%"
        print(f"  {hazard:15s} status={status:10s} accuracy={acc}")

asyncio.run(main())
