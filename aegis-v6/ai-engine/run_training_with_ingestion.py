"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Complete Training Pipeline with Real Data Ingestion
 
 This script implements the full production-grade training workflow:
 1. Check database table row counts
 2. Run data ingestion if < 1000 rows available
 3. Validate dataset meets minimum requirements
 4. Execute model training with comprehensive logging
 5. Export trained models to registry
 6. Abort if any validation fails
═══════════════════════════════════════════════════════════════════════════════
"""

import asyncio
from datetime import datetime, timedelta
from loguru import logger
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.training.data_ingestion import RealDatasetIngestion
from app.training.training_pipeline import TrainingPipeline
from app.core.config import settings


async def run_complete_training_pipeline():
    """
    Execute complete training pipeline with real data ingestion and validation.
    """
    
    logger.info("╔═══════════════════════════════════════════════════════════════════════════════╗")
    logger.info("║       AEGIS AI ENGINE - PRODUCTION TRAINING PIPELINE WITH DATA INGESTION      ║")
    logger.info("╚═══════════════════════════════════════════════════════════════════════════════╝")
    logger.info("")
    
    # Configuration
    hazards = ["flood", "drought", "heatwave"]
    model_type = "random_forest"
    lookback_days = 180
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=lookback_days)
    
    ingestion = RealDatasetIngestion()
    pipeline = TrainingPipeline()
    
    try:
        # ════════════════════════════════════════════════════════════════════
        # PHASE 1: DATA INGESTION AND VALIDATION
        # ════════════════════════════════════════════════════════════════════
        
        logger.info("╔═══════════════════════════════════════════════════════════════════════════════╗")
        logger.info("║                        PHASE 1: DATA INGESTION                                ║")
        logger.info("╚═══════════════════════════════════════════════════════════════════════════════╝")
        logger.info("")
        
        await ingestion.initialize(settings.DATABASE_URL)
        
        # Check current row counts
        logger.info("[Pre-Ingestion Check] Examining database state...")
        initial_counts = await ingestion.check_table_row_counts()
        total_initial_reports = initial_counts.get('reports', 0)
        
        logger.info(f"Current reports in database: {total_initial_reports}")
        
        # Run data ingestion if insufficient data
        if total_initial_reports < RealDatasetIngestion.MINIMUM_REQUIRED_ROWS:
            logger.warning(
                f"Insufficient data: {total_initial_reports} rows < {RealDatasetIngestion.MINIMUM_REQUIRED_ROWS} required"
            )
            logger.info("Initiating external dataset ingestion...")
            
            try:
                ingestion_stats = await ingestion.ingest_complete_training_dataset(
                    lookback_days=lookback_days
                )
                
                logger.info("")
                logger.info("╔═══════════════════════════════════════════════════════════════════════════════╗")
                logger.info("║                       DATA INGESTION COMPLETE                                 ║")
                logger.info("╚═══════════════════════════════════════════════════════════════════════════════╝")
                logger.info("")
                logger.info("Dataset Source: UK Environment Agency Flood Monitoring API")
                logger.info(f"Total Reports Ingested: {ingestion_stats['flood_ingested']}")
                logger.info(f"Total Weather Observations: {ingestion_stats['weather_ingested']}")
                logger.info(f"Final Report Count: {ingestion_stats['final_reports']}")
                logger.info(f"Data Validation: {'✓ PASSED' if ingestion_stats['validation_passed'] else '✗ FAILED'}")
                logger.info("")
                
            except ValueError as e:
                logger.error("")
                logger.error("╔═══════════════════════════════════════════════════════════════════════════════╗")
                logger.error("║                    DATA INGESTION FAILED                                      ║")
                logger.error("╚═══════════════════════════════════════════════════════════════════════════════╝")
                logger.error(str(e))
                logger.error("")
                logger.error("TRAINING ABORTED: Cannot proceed without sufficient real data.")
                logger.error("Please verify:")
                logger.error("  1. Database connection is active")
                logger.error("  2. External data APIs are accessible")
                logger.error("  3. Database has correct schema (run migrations)")
                return
        else:
            logger.success(f"✓ Sufficient data available: {total_initial_reports} rows >= {RealDatasetIngestion.MINIMUM_REQUIRED_ROWS} required")
        
        await ingestion.cleanup()
        
        # ════════════════════════════════════════════════════════════════════
        # PHASE 2: MODEL TRAINING
        # ════════════════════════════════════════════════════════════════════
        
        logger.info("")
        logger.info("╔═══════════════════════════════════════════════════════════════════════════════╗")
        logger.info("║                        PHASE 2: MODEL TRAINING                                ║")
        logger.info("╚═══════════════════════════════════════════════════════════════════════════════╝")
        logger.info("")
        
        training_results = {}
        
        for hazard in hazards:
            logger.info("")
            logger.info("┌───────────────────────────────────────────────────────────────────────────────┐")
            logger.info(f"│  Training Model: {hazard.upper()} + {model_type.upper()}")
            logger.info("└───────────────────────────────────────────────────────────────────────────────┘")
            logger.info("")
            
            try:
                result = await pipeline.train_model(
                    hazard_type=hazard,
                    model_type=model_type,
                    start_date=start_date,
                    end_date=end_date,
                    tune_hyperparams=False,  # Disable for faster training
                    save_model=True,
                    experiment_name=f"{hazard}_{model_type}_production"
                )
                
                training_results[hazard] = result
                
                logger.info("")
                logger.info("┌───────────────────────────────────────────────────────────────────────────────┐")
                logger.info(f"│  {hazard.upper()} MODEL TRAINING COMPLETE")
                logger.info("└───────────────────────────────────────────────────────────────────────────────┘")
                logger.info(f"Model Version: {result.get('model_version', 'N/A')}")
                logger.info(f"Model Path: {result.get('model_path', 'N/A')}")
                
                metrics = result.get('metrics', {})
                logger.info("")
                logger.info("Final Training Metrics:")
                logger.info(f"  • Accuracy: {metrics.get('accuracy', 0):.4f}")
                logger.info(f"  • Precision: {metrics.get('precision', 0):.4f}")
                logger.info(f"  • Recall: {metrics.get('recall', 0):.4f}")
                logger.info(f"  • F1 Score: {metrics.get('f1', 0):.4f}")
                logger.info(f"  • ROC AUC: {metrics.get('roc_auc', 0):.4f}")
                logger.info("")
                
            except Exception as e:
                logger.error(f"✗ Training failed for {hazard}: {e}")
                training_results[hazard] = {"status": "failed", "error": str(e)}
        
        # ════════════════════════════════════════════════════════════════════
        # PHASE 3: FINAL REPORT
        # ════════════════════════════════════════════════════════════════════
        
        logger.info("")
        logger.info("╔═══════════════════════════════════════════════════════════════════════════════╗")
        logger.info("║                      TRAINING PIPELINE COMPLETE                               ║")
        logger.info("╚═══════════════════════════════════════════════════════════════════════════════╝")
        logger.info("")
        logger.info("Summary:")
        
        successful = sum(1 for r in training_results.values() if r.get('metrics'))
        failed = len(training_results) - successful
        
        logger.info(f"  • Total hazards trained: {len(hazards)}")
        logger.info(f"  • Successful: {successful}")
        logger.info(f"  • Failed: {failed}")
        logger.info("")
        
        for hazard, result in training_results.items():
            status = "✓ SUCCESS" if result.get('metrics') else "✗ FAILED"
            logger.info(f"  {hazard.ljust(12)}: {status}")
        
        logger.info("")
        logger.info("Next Steps:")
        logger.info("  1. Restart AI Engine to load newly trained models")
        logger.info("  2. Test predictions via /api/predict endpoint")
        logger.info("  3. Monitor model performance on live data")
        logger.info("  4. Set up automated retraining schedule")
        logger.info("")
        
    except Exception as e:
        logger.exception(f"Pipeline execution failed: {e}")
        raise
    finally:
        # Cleanup
        if ingestion.db_pool:
            await ingestion.cleanup()


if __name__ == "__main__":
    asyncio.run(run_complete_training_pipeline())
