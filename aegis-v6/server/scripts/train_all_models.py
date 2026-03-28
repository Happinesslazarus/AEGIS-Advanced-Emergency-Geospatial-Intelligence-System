#!/usr/bin/env python3
"""
AEGIS World-Class Model Training Script
Trains all ML models from the seeded database data.
Runs: report_classifier, severity_predictor, fake_detector, and the production ML pipeline.
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Add ai-engine to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "ai-engine"))
os.chdir(str(Path(__file__).parent.parent.parent / "ai-engine"))

DB_URL = "postgresql://postgres:Happylove%40%21@localhost:5432/aegis"

async def train_report_classifier():
    """Train the hazard type classifier."""
    print("\n" + "=" * 60)
    print("TRAINING: Report Classifier (hazard type)")
    print("=" * 60)
    
    try:
        from app.models.report_classifier_ml import ReportClassifierML
        
        clf = ReportClassifierML(db_url=DB_URL)
        result = await clf.train()
        
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
    print("TRAINING: Severity Predictor")
    print("=" * 60)
    
    try:
        from app.models.severity_predictor import SeverityPredictor
        
        pred = SeverityPredictor(db_url=DB_URL)
        result = await pred.train()
        
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
    print("TRAINING: Fake Report Detector")
    print("=" * 60)
    
    try:
        from app.models.fake_detector_ml import FakeDetectorML
        
        det = FakeDetectorML(db_url=DB_URL)
        result = await det.train()
        
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
    print("TRAINING: Production ML Pipeline (XGBoost + RF)")
    print("=" * 60)
    
    try:
        from app.training.ml_pipeline import ProductionMLPipeline
        
        model_dir = str(Path("model_registry"))
        pipeline = ProductionMLPipeline(db_url=DB_URL, model_registry_path=model_dir)
        
        result = await pipeline.train_all()
        
        print(f"  Models trained: {len(result.get('models', []))}")
        for model_result in result.get("models", []):
            name = model_result.get("model_name", "unknown")
            acc = model_result.get("accuracy", "N/A")
            f1 = model_result.get("f1_score", "N/A")
            print(f"    {name}: accuracy={acc}, f1={f1}")
        
        return result
    except Exception as e:
        print(f"  FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "failed", "error": str(e)}

async def train_hazard_models():
    """Train hazard-specific models (flood, drought, heatwave)."""
    print("\n" + "=" * 60)
    print("TRAINING: Hazard-Specific Models (flood/drought/heatwave)")
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
    print("AEGIS WORLD-CLASS MODEL TRAINING")
    print("=" * 60)
    
    start_time = time.time()
    all_results = {}
    
    # Train models sequentially (they share resources)
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
        status = result.get("status", "unknown") if isinstance(result, dict) else "completed"
        print(f"  {name}: {status}")
    
    # Save results
    output_path = Path(__file__).parent / "training_results.json"
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\nResults saved to {output_path}")

if __name__ == "__main__":
    asyncio.run(main())
