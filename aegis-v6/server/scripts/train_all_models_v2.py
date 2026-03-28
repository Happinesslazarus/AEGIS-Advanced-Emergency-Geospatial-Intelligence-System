#!/usr/bin/env python3
"""
AEGIS World-Class Model Training Script (v2)
Trains all ML models from the seeded database data.
Uses correct class names and APIs.
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Add ai-engine to path
ai_engine_path = str(Path(__file__).parent.parent.parent / "ai-engine")
sys.path.insert(0, ai_engine_path)
os.chdir(ai_engine_path)

DB_URL = "postgresql://postgres:Happylove%40%21@localhost:5432/aegis"

async def train_report_classifier():
    """Train the hazard type classifier."""
    print("\n" + "=" * 60)
    print("TRAINING 1/5: Report Classifier (hazard type)")
    print("=" * 60)
    
    try:
        from app.models.report_classifier_ml import ReportClassifierTrainable
        
        clf = ReportClassifierTrainable()
        result = await clf.async_train(db_url=DB_URL)
        
        print(f"  Status: {result.get('status', 'unknown')}")
        print(f"  Accuracy: {result.get('accuracy', 'N/A')}")
        print(f"  F1 Score: {result.get('f1_score', 'N/A')}")
        print(f"  Training samples: {result.get('training_samples', 'N/A')}")
        print(f"  Classes: {result.get('classes', 'N/A')}")
        return result
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "failed", "error": str(e)}

async def train_severity_predictor():
    """Train the severity predictor."""
    print("\n" + "=" * 60)
    print("TRAINING 2/5: Severity Predictor")
    print("=" * 60)
    
    try:
        from app.models.severity_predictor import SeverityPredictor
        
        pred = SeverityPredictor()
        result = await pred.async_train(db_url=DB_URL)
        
        print(f"  Status: {result.get('status', 'unknown')}")
        print(f"  Accuracy: {result.get('accuracy', 'N/A')}")
        print(f"  F1 Score: {result.get('f1_score', 'N/A')}")
        print(f"  Training samples: {result.get('training_samples', 'N/A')}")
        return result
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "failed", "error": str(e)}

async def train_fake_detector():
    """Train the fake report detector."""
    print("\n" + "=" * 60)
    print("TRAINING 3/5: Fake Report Detector")
    print("=" * 60)
    
    try:
        from app.models.fake_detector_ml import FakeDetectorTrainable
        
        det = FakeDetectorTrainable()
        result = await det.async_train(db_url=DB_URL)
        
        print(f"  Status: {result.get('status', 'unknown')}")
        print(f"  Accuracy: {result.get('accuracy', 'N/A')}")
        print(f"  F1 Score: {result.get('f1_score', 'N/A')}")
        print(f"  Training samples: {result.get('training_samples', 'N/A')}")
        return result
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "failed", "error": str(e)}

async def train_production_pipeline():
    """Train all models via the production ML pipeline."""
    print("\n" + "=" * 60)
    print("TRAINING 4/5: Production ML Pipeline (XGBoost + RF)")
    print("=" * 60)
    
    try:
        from app.training.ml_pipeline import ProductionMLPipeline
        
        model_dir = str(Path("model_registry"))
        pipeline = ProductionMLPipeline(db_url=DB_URL, model_registry_path=model_dir)
        
        result = await pipeline.train_all_models()
        
        if isinstance(result, dict):
            for key, val in result.items():
                print(f"  {key}: {val}")
        else:
            print(f"  Result: {result}")
        
        return result if isinstance(result, dict) else {"status": "completed", "result": str(result)}
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "failed", "error": str(e)}

async def train_hazard_models():
    """Train hazard-specific models (flood, drought, heatwave)."""
    print("\n" + "=" * 60)
    print("TRAINING 5/5: Hazard-Specific Models (flood/drought/heatwave)")
    print("=" * 60)
    
    try:
        from app.training.training_pipeline import TrainingPipeline
        from datetime import datetime, timedelta
        
        pipeline = TrainingPipeline("config.yaml")
        end = datetime.utcnow()
        start = end - timedelta(days=730)  # 2 years of seeded data
        
        results = {}
        for hazard in ["flood", "drought", "heatwave"]:
            print(f"\n  Training {hazard} model...")
            try:
                result = await pipeline.train_model(
                    hazard_type=hazard,
                    model_type="random_forest",
                    start_date=start,
                    end_date=end,
                    tune_hyperparams=False,
                    save_model=True,
                    experiment_name=f"{hazard}_rf_prod",
                )
                metrics = result.get("metrics", {})
                print(f"    {hazard}: {metrics}")
                results[hazard] = result
            except Exception as e:
                print(f"    {hazard} failed: {e}")
                results[hazard] = {"status": "failed", "error": str(e)}
        
        return results
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "failed", "error": str(e)}

async def main():
    print("=" * 60)
    print("AEGIS WORLD-CLASS MODEL TRAINING v2")
    print("=" * 60)
    
    start_time = time.time()
    all_results = {}
    
    # Train models sequentially
    all_results["report_classifier"] = await train_report_classifier()
    all_results["severity_predictor"] = await train_severity_predictor()
    all_results["fake_detector"] = await train_fake_detector()
    all_results["production_pipeline"] = await train_production_pipeline()
    all_results["hazard_models"] = await train_hazard_models()
    
    elapsed = time.time() - start_time
    
    # Summary
    print("\n" + "=" * 60)
    print(f"TRAINING COMPLETE — {elapsed:.1f}s total")
    print("=" * 60)
    
    for name, result in all_results.items():
        if isinstance(result, dict):
            status = result.get("status", "completed")
            acc = result.get("accuracy", "")
            f1 = result.get("f1_score", "")
            extra = f" (acc={acc}, f1={f1})" if acc else ""
            print(f"  {name}: {status}{extra}")
        else:
            print(f"  {name}: completed")
    
    # Save results
    output_path = Path(__file__).parent / "training_results.json"
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\nResults saved to {output_path}")

if __name__ == "__main__":
    asyncio.run(main())
