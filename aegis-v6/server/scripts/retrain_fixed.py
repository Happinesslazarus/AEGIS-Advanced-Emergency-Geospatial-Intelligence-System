"""
Module: retrain_fixed.py

Retrain_fixed utility script.

Simple explanation:
Standalone script for retrain_fixed.
"""
import os
import sys
import asyncio
import time

# Set DATABASE_URL for all submodules
os.environ['DATABASE_URL'] = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

# Add ai-engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))
os.chdir(os.path.join(os.path.dirname(__file__), '..', '..', 'ai-engine'))

DB_URL = os.environ['DATABASE_URL']
results = {}

async def train_severity():
    """Re-train severity predictor with correlated labels."""
    from app.models.severity_predictor import SeverityPredictor
    print("\n" + "=" * 60)
    print("RE-TRAINING: Severity Predictor (improved labels)")
    print("=" * 60)
    
    pred = SeverityPredictor()
    result = await pred.async_train(db_url=DB_URL)
    
    acc = getattr(pred, '_last_accuracy', None)
    if hasattr(result, 'get'):
        acc = result.get('accuracy', acc)
    
    results['severity_predictor'] = {
        'status': 'completed',
        'accuracy': acc,
        'result': str(result)[:200] if result else 'None'
    }
    print(f"  Result: {results['severity_predictor']}")

async def train_production_pipeline():
    """Re-train production ML pipeline (fixed DataFrame columns)."""
    from app.training.ml_pipeline import ProductionMLPipeline
    print("\n" + "=" * 60)
    print("RE-TRAINING: Production ML Pipeline (fixed columns)")
    print("=" * 60)
    
    registry = os.path.join(os.getcwd(), 'model_registry')
    pipeline = ProductionMLPipeline(DB_URL, registry)
    
    try:
        result = await pipeline.train_all_models()
        results['production_pipeline'] = {
            'status': 'completed',
            'result': str(result)[:200] if result else 'None'
        }
    except Exception as e:
        results['production_pipeline'] = {
            'status': 'failed',
            'error': str(e)
        }
    
    print(f"  Result: {results['production_pipeline']}")

async def train_hazard_models():
    """Train hazard-specific models (fixed FeatureEngineer)."""
    from datetime import datetime, timedelta
    print("\n" + "=" * 60)
    print("RE-TRAINING: Hazard-Specific Models")
    print("=" * 60)
    
    try:
        from app.training.training_pipeline import TrainingPipeline
        
        config_path = os.path.join(os.getcwd(), 'config.yaml')
        pipeline = TrainingPipeline(config_path)
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=730)
        
        for hazard in ['flood', 'drought', 'heatwave']:
            print(f"\n  Training {hazard}...")
            try:
                result = await pipeline.train_model(
                    hazard_type=hazard,
                    model_type='xgboost',
                    start_date=start_date,
                    end_date=end_date,
                    tune_hyperparams=False,
                    save_model=True
                )
                results[f'hazard_{hazard}'] = {
                    'status': 'completed',
                    'metrics': {k: v for k, v in result.items() if k in ('accuracy', 'f1', 'rmse', 'r2')} if isinstance(result, dict) else str(result)[:200]
                }
                print(f"    {hazard}: SUCCESS - {results[f'hazard_{hazard}']}")
            except Exception as e:
                results[f'hazard_{hazard}'] = {
                    'status': 'failed',
                    'error': str(e)[:200]
                }
                print(f"    {hazard}: FAILED - {e}")
    except Exception as e:
        results['hazard_models'] = {
            'status': 'failed',
            'error': str(e)[:200]
        }
        print(f"  ALL FAILED: {e}")
        import traceback
        traceback.print_exc()

async def main():
    overall_start = time.time()
    
    # 1. Re-train severity predictor
    try:
        await train_severity()
    except Exception as e:
        results['severity_predictor'] = {'status': 'failed', 'error': str(e)[:200]}
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    # 2. Re-train production pipeline
    try:
        await train_production_pipeline()
    except Exception as e:
        results['production_pipeline'] = {'status': 'failed', 'error': str(e)[:200]}
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    # 3. Train hazard models
    try:
        await train_hazard_models()
    except Exception as e:
        results['hazard_models'] = {'status': 'failed', 'error': str(e)[:200]}
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    elapsed = time.time() - overall_start
    
    print("\n" + "=" * 60)
    print(f"RE-TRAINING COMPLETE Ã¢â‚¬â€ {elapsed:.1f}s total")
    print("=" * 60)
    for name, res in results.items():
        status = res.get('status', 'unknown')
        extra = res.get('accuracy', res.get('error', ''))
        print(f"  {name}: {status} {f'(acc={extra})' if extra else ''}")

asyncio.run(main())
