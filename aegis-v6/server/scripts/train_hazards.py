"""
Module: train_hazards.py

Train_hazards utility script.

Simple explanation:
Standalone script for train_hazards.
"""
import os, sys, asyncio, time
from datetime import datetime, timedelta

os.environ['DATABASE_URL'] = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))
os.chdir(os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))

async def main():
    from app.training.training_pipeline import TrainingPipeline
    
    config_path = os.path.join(os.getcwd(), 'config.yaml')
    pipeline = TrainingPipeline(config_path)
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=730)
    
    for hazard in ['flood', 'drought', 'heatwave']:
        print(f"\n{'='*60}")
        print(f"Training {hazard}...")
        print(f"{'='*60}")
        t0 = time.time()
        try:
            result = await pipeline.train_model(
                hazard_type=hazard,
                model_type='xgboost',
                start_date=start_date,
                end_date=end_date,
                tune_hyperparams=False,
                save_model=True
            )
            elapsed = time.time() - t0
            print(f"  {hazard}: SUCCESS ({elapsed:.1f}s)")
            if isinstance(result, dict):
                for k in ('accuracy', 'f1', 'rmse', 'r2', 'best_score'):
                    if k in result:
                        print(f"    {k}: {result[k]}")
        except Exception as e:
            print(f"  {hazard}: FAILED ({time.time()-t0:.1f}s) - {e}")
            import traceback
            traceback.print_exc()

asyncio.run(main())
