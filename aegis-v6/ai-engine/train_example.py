"""
Train_example AI engine module.
"""

import asyncio
import argparse
from datetime import datetime, timedelta
from loguru import logger
import sys

from app.training import TrainingPipeline

async def train_single_model(hazard_type: str, model_type: str, tune: bool = False):
    """
    Train a single model.
    
    Args:
        hazard_type: Type of hazard ('flood', 'drought', 'heatwave')
        model_type: Type of model ('xgboost', 'lightgbm', 'catboost', 'random_forest')
        tune: Whether to run hyperparameter tuning
    """
    logger.info(f"Training {model_type} model for {hazard_type} hazard")
    
    # Initialize pipeline
    pipeline = TrainingPipeline("config.yaml")
    
    # Define training date range (last 90 days)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=90)
    
    try:
        # Train model
        results = await pipeline.train_model(
            hazard_type=hazard_type,
            model_type=model_type,
            start_date=start_date,
            end_date=end_date,
            tune_hyperparams=tune,
            save_model=True
        )
        
        # Print results
        logger.success("Training completed successfully!")
        logger.info(f"Model path: {results['model_path']}")
        logger.info(f"Number of features: {results['n_features']}")
        logger.info(f"Training samples: {results['n_train_samples']}")
        logger.info(f"Validation samples: {results['n_val_samples']}")
        logger.info("\nMetrics:")
        
        for metric, value in results['metrics'].items():
            logger.info(f"  {metric}: {value:.4f}")
        
        logger.info("\nTop 10 Important Features:")
        for i, feat in enumerate(results['feature_importance'][:10], 1):
            logger.info(f"  {i}. {feat['feature']}: {feat['importance']:.4f}")
        
        return results
    
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise

async def train_all_models_for_hazard(hazard_type: str):
    """
    Train all available models for a hazard type.
    
    Args:
        hazard_type: Type of hazard
    """
    logger.info(f"Training all models for {hazard_type} hazard")
    
    # Initialize pipeline
    pipeline = TrainingPipeline("config.yaml")
    
    # Define training date range
    end_date = datetime.now()
    start_date = end_date - timedelta(days=90)
    
    try:
        # Train all models
        results = await pipeline.train_all_models(
            hazard_type=hazard_type,
            start_date=start_date,
            end_date=end_date
        )
        
        # Compare results
        comparison = pipeline.compare_model_results(results)
        
        logger.success(f"Trained {len(results)} models successfully!")
        logger.info("\nModel Comparison (sorted by F1 score):")
        logger.info(comparison.to_string())
        
        # Find best model
        if 'f1_score' in comparison.columns:
            best_model = comparison.loc[comparison['f1_score'].idxmax()]
            logger.info(f"\nBest Model: {best_model['model_type']}")
            logger.info(f"F1 Score: {best_model['f1_score']:.4f}")
            logger.info(f"ROC AUC: {best_model.get('roc_auc', 'N/A')}")
        
        return results
    
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise

async def train_all_hazards():
    """Train models for all enabled hazards."""
    logger.info("Training models for all hazards")
    
    hazards = ['flood', 'drought', 'heatwave']
    
    all_results = {}
    
    for hazard in hazards:
        logger.info(f"\n{'='*80}\nTraining models for {hazard}\n{'='*80}")
        
        try:
            results = await train_all_models_for_hazard(hazard)
            all_results[hazard] = results
        except Exception as e:
            logger.error(f"Failed to train models for {hazard}: {e}")
            continue
    
    logger.success(f"\nCompleted training for {len(all_results)} hazards")
    
    return all_results

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='AEGIS AI Engine - Model Training',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Train single model
  python train_example.py --hazard flood --model xgboost
  
  # Train with hyperparameter tuning
  python train_example.py --hazard flood --model xgboost --tune
  
  # Train all models for a hazard
  python train_example.py --hazard flood --train-all-models
  
  # Train all hazards
  python train_example.py --train-all
        """
    )
    
    parser.add_argument(
        '--hazard',
        type=str,
        choices=['flood', 'drought', 'heatwave'],
        help='Hazard type to train for'
    )
    
    parser.add_argument(
        '--model',
        type=str,
        choices=['xgboost', 'lightgbm', 'catboost', 'random_forest', 'lstm'],
        help='Model type to train'
    )
    
    parser.add_argument(
        '--tune',
        action='store_true',
        help='Enable hyperparameter tuning (slower but better results)'
    )
    
    parser.add_argument(
        '--train-all-models',
        action='store_true',
        help='Train all model types for the specified hazard'
    )
    
    parser.add_argument(
        '--train-all',
        action='store_true',
        help='Train all models for all hazards'
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.train_all:
        # Train everything
        logger.info("Starting comprehensive training for all hazards and models")
        asyncio.run(train_all_hazards())
    
    elif args.train_all_models:
        # Train all models for one hazard
        if not args.hazard:
            logger.error("--hazard is required when using --train-all-models")
            sys.exit(1)
        
        asyncio.run(train_all_models_for_hazard(args.hazard))
    
    elif args.hazard and args.model:
        # Train single model
        asyncio.run(train_single_model(args.hazard, args.model, args.tune))
    
    else:
        parser.print_help()
        logger.error("\nError: Must specify either:")
        logger.error("  1. --hazard and --model for single model training")
        logger.error("  2. --hazard and --train-all-models for training all models")
        logger.error("  3. --train-all for comprehensive training")
        sys.exit(1)

if __name__ == "__main__":
    main()
