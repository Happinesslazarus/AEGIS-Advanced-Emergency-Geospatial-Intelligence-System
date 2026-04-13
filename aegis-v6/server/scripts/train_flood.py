"""
Module: train_flood.py

Train_flood utility script.

Simple explanation:
Standalone script for train_flood.
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
    
    t0 = time.time()
    result = await pipeline.train_model(
        hazard_type='flood',
        model_type='xgboost',
        start_date=start_date,
        end_date=end_date,
        tune_hyperparams=False,
        save_model=True
    )
    print(f"\nFlood model trained in {time.time()-t0:.1f}s")
    if isinstance(result, dict):
        for k, v in result.items():
            if k not in ('model', 'feature_importance'):
                print(f"  {k}: {v}")

asyncio.run(main())
