"""
Complete end-to-end training workflow orchestrator. Steps: data loading,
validation, feature engineering, train/val split, optional hyperparameter
tuning (Optuna), model training, evaluation, and model registration with
governance metadata. Used as the unified entry point when training all
hazard models in one pass.

- Invoked by ai-engine/run_training_all.py and train_all.py
- Delegates data loading to training/data_loaders.py and data_ingestion.py
- Feature engineering via training/feature_engineering.py
- Saves model with governance via core/model_registry.py + core/governance.py
- Hyperparameter search via training/hyperparameter_tuner.py (optional)
"""

# Complete end-to-end training workflow:
# 1. Data loading and validation
# 2. Feature engineering
# 3. Train/validation split
# 4. Hyperparameter tuning (optional)
# 5. Model training
# 6. Evaluation and metrics
# 7. Model registration
# 8. Experiment tracking

import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple, Optional
from loguru import logger
from datetime import datetime
from pathlib import Path
import yaml
import json
import shutil

from sklearn.model_selection import train_test_split, TimeSeriesSplit

from .data_loaders import DataLoader, FeatureExtractor
from .feature_engineering import FeatureEngineer
from .model_trainer import ModelTrainer
from .evaluator import ModelEvaluator
from .hyperparameter_tuner import HyperparameterTuner
from .experiment_tracker import ExperimentTracker

class TrainingPipeline:
    """
    Orchestrate complete model training pipeline.
    Implements workflow defined in config.yaml.
    """
    
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize training pipeline with all components."""
        logger.info("Initializing AEGIS Training Pipeline")
        
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        # Initialize components
        self.data_loader = DataLoader(config_path)
        self.feature_extractor = FeatureExtractor(config_path)
        self.feature_engineer = FeatureEngineer()
        self.model_trainer = ModelTrainer(config_path)
        self.evaluator = ModelEvaluator(config_path)
        self.hp_tuner = HyperparameterTuner(config_path)
        self.experiment_tracker = ExperimentTracker(config_path)
        
        # Configuration
        self.seed = self.config['training']['reproducibility']['random_seed']
        self.validation_config = self.config['training']['validation']
        
        logger.success("Training pipeline initialized")
    
    async def train_model(
        self,
        hazard_type: str,
        model_type: str,
        start_date: datetime,
        end_date: datetime,
        tune_hyperparams: bool = True,
        save_model: bool = True,
        experiment_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute complete training pipeline for a hazard-model combination.
        
        Args:
            hazard_type: Type of hazard ('flood', 'drought', 'heatwave')
            model_type: Type of model ('xgboost', 'lightgbm', 'catboost', 'random_forest', 'lstm')
            start_date: Start of training data range
            end_date: End of training data range
            tune_hyperparams: Whether to run hyperparameter tuning
            save_model: Whether to save trained model
            experiment_name: Custom name for MLflow experiment
        
        Returns:
            Dictionary with training results, metrics, and model path
        """
        logger.info(f"Starting training pipeline: {hazard_type} - {model_type}")
        logger.info(f"Training data range: {start_date} to {end_date}")
        
        # Start MLflow run
        run_name = experiment_name or f"{hazard_type}_{model_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        mlflow_run = self.experiment_tracker.start_run(
            run_name=run_name,
            hazard_type=hazard_type,
            model_type=model_type
        )
        
        try:
            # Step 1: Initialize data loader
            await self.data_loader.initialize()
            
            # Step 2: Load training data
            logger.info("=" * 80)
            logger.info("Step 1/7: Loading training data")
            logger.info("=" * 80)
            features_df, labels_df = await self.data_loader.create_training_dataset(
                hazard_type=hazard_type,
                lookback_days=(end_date - start_date).days
            )
            
            # CRITICAL VALIDATION: Verify real data was loaded (not empty, synthetic, or fallback)
            if len(features_df) == 0:
                error_msg = (
                    f"TRAINING ABORTED: Zero rows returned from data loader for hazard '{hazard_type}'. "
                    f"Training cannot proceed on empty datasets. Run data ingestion pipeline first."
                )
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            if len(features_df) < 100:
                logger.warning(
                    f"WARNING: Only {len(features_df)} training samples available. "
                    f"This is insufficient for production-grade models. Recommend >= 1000 samples."
                )
            
            dataset_info = {
                'n_samples': len(features_df),
                'n_features': len(features_df.columns),
                'start_date': str(start_date),
                'end_date': str(end_date),
                'hazard_type': hazard_type
            }
            
            logger.info(f" Loaded {len(features_df)} training samples with {len(features_df.columns)} base features")
            logger.info(f"  Date range: {start_date} to {end_date}")
            logger.info(f"  Hazard type: {hazard_type}")
            
            self.experiment_tracker.log_dataset_info(dataset_info)
            
            # Step 3: Feature engineering
            logger.info("=" * 80)
            logger.info("Step 2/7: Engineering features")
            logger.info("=" * 80)
            features_engineered = self.feature_engineer.engineer_all_features(
                df=features_df,
                hazard_type=hazard_type,
                timestamp_col='timestamp'
            )
            
            # Remove timestamp for training
            if 'timestamp' in features_engineered.columns:
                features_engineered = features_engineered.drop(columns=['timestamp'])

            # Encode categorical/object features for ML estimators
            object_cols = features_engineered.select_dtypes(include=['object', 'category']).columns.tolist()
            if object_cols:
                logger.info(f"Encoding {len(object_cols)} categorical features: {object_cols}")
                features_engineered = pd.get_dummies(features_engineered, columns=object_cols, drop_first=False)
            
            logger.info(f" Feature engineering complete: {len(features_engineered.columns)} total features")
            
            # Step 4: Train/validation split
            logger.info("=" * 80)
            logger.info("Step 3/7: Creating train/validation split")
            logger.info("=" * 80)
            
            X = features_engineered.fillna(0)
            y = labels_df['target'].values
            
            # CRITICAL PRE-TRAINING VALIDATION AND LOGGING
            logger.info("PRE-TRAINING VALIDATION:")
            logger.info(f"  - Total rows used: {len(X)}")
            logger.info(f"  - Feature columns used: {len(X.columns)}")
            logger.info(f"  - Feature names: {list(X.columns[:20])}{'...' if len(X.columns) > 20 else ''}")
            logger.info(f"  - Target column: 'target' (binary classification)")
            logger.info(f"  - Target distribution: Class 0: {(y==0).sum()}, Class 1: {(y==1).sum()}")
            logger.info(f"  - Target balance: {(y==1).sum() / len(y) * 100:.1f}% positive class")
            
            # Validate target distribution
            if (y==0).sum() == 0 or (y==1).sum() == 0:
                error_msg = (
                    f"TRAINING ABORTED: Single-class target detected (Class 0: {(y==0).sum()}, Class 1: {(y==1).sum()}). "
                    f"Cannot train a valid classifier. This indicates insufficient or imbalanced real data."
                )
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Stratified split to ensure both classes appear in train and validation
            # Time-series split is inappropriate when data is concatenated pos+neg reports
            X_train, X_val, y_train, y_val = train_test_split(
                X, y,
                test_size=self.validation_config['test_size'],
                random_state=self.seed,
                stratify=y
            )
            
            logger.info(f" Train/test split complete:")
            logger.info(f"  - Training set: {len(X_train)} samples ({len(X_train)/len(X)*100:.1f}%)")
            logger.info(f"  - Validation set: {len(X_val)} samples ({len(X_val)/len(X)*100:.1f}%)")
            logger.info(f"  - Train target distribution: Class 0: {(y_train==0).sum()}, Class 1: {(y_train==1).sum()}")
            logger.info(f"  - Validation target distribution: Class 0: {(y_val==0).sum()}, Class 1: {(y_val==1).sum()}")
            
            # Step 5: Hyperparameter tuning (optional)
            best_params = None
            
            if tune_hyperparams and self.hp_tuner.enabled:
                logger.info("Step 4/7: Tuning hyperparameters")
                
                # Define objective function
                def objective(trial):
                    # Get suggested params
                    if model_type == 'xgboost':
                        import xgboost as xgb
                        params = self.hp_tuner.suggest_xgboost_params(trial)
                        model = self.model_trainer.train_xgboost(X_train, y_train, X_val, y_val, params)
                        y_pred = model.predict(xgb.DMatrix(X_val))
                    elif model_type == 'lightgbm':
                        params = self.hp_tuner.suggest_lightgbm_params(trial)
                        model = self.model_trainer.train_lightgbm(X_train, y_train, X_val, y_val, params)
                        y_pred = model.predict(X_val)
                    elif model_type == 'catboost':
                        params = self.hp_tuner.suggest_catboost_params(trial)
                        model = self.model_trainer.train_catboost(X_train, y_train, X_val, y_val, params)
                        y_pred = model.predict(X_val)
                    elif model_type == 'random_forest':
                        params = self.hp_tuner.suggest_random_forest_params(trial)
                        model = self.model_trainer.train_random_forest(X_train, y_train, params=params)
                        y_pred = model.predict(X_val)
                    else:
                        return 0.0
                    
                    # Convert probabilities if needed
                    if hasattr(model, 'predict_proba'):
                        y_pred_prob = model.predict_proba(X_val)[:, 1] if len(model.classes_) > 1 else y_pred
                    else:
                        y_pred_prob = y_pred
                    
                    # Calculate F1 score
                    from sklearn.metrics import f1_score
                    y_pred_binary = (y_pred_prob > 0.5).astype(int)
                    return f1_score(y_val, y_pred_binary)
                
                # Run optimization
                study = self.hp_tuner.optimize(
                    objective_fn=objective,
                    model_type=model_type,
                    direction='maximize',
                    n_trials=50  # Reduced for demo
                )
                
                best_params = self.hp_tuner.get_best_params(study, model_type)
                self.experiment_tracker.log_params({'tuned_params': best_params})
                
                logger.success(f"Hyperparameter tuning complete. Best F1: {study.best_value:.4f}")
            else:
                logger.info("Step 4/7: Using default hyperparameters")
                best_params = self.hp_tuner.get_default_params(model_type)
            
            # Step 6: Train final model
            logger.info("Step 5/7: Training final model")
            
            if model_type == 'xgboost':
                import xgboost as xgb
                model = self.model_trainer.train_xgboost(
                    X_train, y_train, X_val, y_val, best_params
                )
            elif model_type == 'lightgbm':
                model = self.model_trainer.train_lightgbm(
                    X_train, y_train, X_val, y_val, best_params
                )
            elif model_type == 'catboost':
                model = self.model_trainer.train_catboost(
                    X_train, y_train, X_val, y_val, best_params
                )
            elif model_type == 'random_forest':
                model = self.model_trainer.train_random_forest(
                    X_train, y_train, params=best_params
                )
            else:
                raise ValueError(f"Unsupported model type: {model_type}")
            
            logger.success("Model training complete")
            
            # Step 7: Evaluate model
            logger.info("Step 6/7: Evaluating model")
            
            # Get predictions
            if model_type == 'xgboost':
                import xgboost as xgb
                y_pred_prob = model.predict(xgb.DMatrix(X_val))
            elif model_type == 'lightgbm':
                y_pred_prob = model.predict(X_val)
            else:
                if hasattr(model, 'predict_proba'):
                    y_pred_prob = model.predict_proba(X_val)[:, 1]
                else:
                    y_pred_prob = model.predict(X_val)
            
            y_pred_binary = (y_pred_prob > 0.5).astype(int)
            
            # Calculate metrics
            metrics = self.evaluator.evaluate_classification(
                y_true=y_val,
                y_pred=y_pred_binary,
                y_prob=y_pred_prob
            )
            
            self.experiment_tracker.log_metrics(metrics)
            
            # Feature importance
            feature_importance = self.evaluator.get_feature_importance(
                model=model,
                feature_names=X_train.columns.tolist(),
                model_type=model_type
            )
            
            self.experiment_tracker.log_feature_importance(
                feature_names=feature_importance['feature'].tolist(),
                importance_values=feature_importance['importance'].tolist()
            )
            
            logger.success(f"Evaluation complete: {metrics}")
            
            # Step 8: Save model
            model_path = None
            
            if save_model:
                logger.info("Step 7/7: Saving model")
                
                model_dir = Path(f"./model_registry/{hazard_type}/{model_type}")
                model_dir.mkdir(parents=True, exist_ok=True)
                
                model_path = model_dir / f"model_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pkl"
                
                self.model_trainer.save_model(model, str(model_path), model_type)

                # Export serving-compatible registry bundle: {hazard}_{region}_{version}/(model.pkl, metadata.json)
                region_id = "uk-default"
                version = f"v{datetime.now().strftime('%Y.%m.%d.%H%M%S')}"
                serving_dir = Path(f"./model_registry/{hazard_type}_{region_id}_{version}")
                serving_dir.mkdir(parents=True, exist_ok=True)

                serving_model_path = serving_dir / "model.pkl"
                shutil.copyfile(model_path, serving_model_path)

                serving_metadata = {
                    "name": f"{hazard_type}_{model_type}",
                    "version": version,
                    "hazard_type": hazard_type,
                    "region_id": region_id,
                    "model_type": model_type,
                    "trained_at": datetime.utcnow().isoformat(),
                    "performance_metrics": {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float, np.floating))},
                    "feature_names": X_train.columns.tolist(),
                    "source_model_path": str(model_path)
                }
                with open(serving_dir / "metadata.json", "w", encoding="utf-8") as f:
                    json.dump(serving_metadata, f, indent=2)
                
                # Log model to MLflow
                self.experiment_tracker.log_model(
                    model=model,
                    artifact_path="model",
                    model_type="sklearn"  # Fallback to sklearn for serialization
                )
                
                logger.success(f"Model saved to {model_path}")
                logger.success(f"Serving bundle exported to {serving_dir}")
            
            # Cleanup
            await self.data_loader.cleanup()
            
            # End MLflow run
            self.experiment_tracker.end_run()
            
            # Return results
            results = {
                'hazard_type': hazard_type,
                'model_type': model_type,
                'metrics': metrics,
                'feature_importance': feature_importance.head(20).to_dict('records'),
                'model_path': str(model_path) if model_path else None,
                'n_features': len(X_train.columns),
                'n_train_samples': len(X_train),
                'n_val_samples': len(X_val),
                'training_date': datetime.now().isoformat()
            }
            
            logger.success("Training pipeline complete!")
            
            return results
        
        except Exception as e:
            logger.error(f"Training pipeline failed: {e}")
            self.experiment_tracker.end_run()
            raise
    
    async def train_all_models(
        self,
        hazard_type: str,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict[str, Any]]:
        """
        Train all model types for a specific hazard.
        
        Args:
            hazard_type: Type of hazard
            start_date: Start of training data range
            end_date: End of training data range
        
        Returns:
            List of results for each model
        """
        logger.info(f"Training all models for {hazard_type}")
        
        # Get model types from config
        hazard_config = self.config['hazards'].get(hazard_type, {})
        model_configs = hazard_config.get('models', [])
        
        model_types = []
        for model_config in model_configs:
            model_arch = model_config.get('architecture', '').lower()
            if 'xgboost' in model_arch:
                model_types.append('xgboost')
            elif 'lightgbm' in model_arch:
                model_types.append('lightgbm')
            elif 'catboost' in model_arch:
                model_types.append('catboost')
            elif 'randomforest' in model_arch:
                model_types.append('random_forest')
        
        # Fallback to default models
        if not model_types:
            model_types = ['xgboost', 'lightgbm', 'random_forest']
        
        results = []
        
        for model_type in model_types:
            logger.info(f"Training {model_type} for {hazard_type}")
            
            try:
                result = await self.train_model(
                    hazard_type=hazard_type,
                    model_type=model_type,
                    start_date=start_date,
                    end_date=end_date,
                    tune_hyperparams=False,  # Skip tuning for batch training
                    save_model=True
                )
                results.append(result)
            
            except Exception as e:
                logger.error(f"Failed to train {model_type}: {e}")
                continue
        
        logger.success(f"Trained {len(results)}/{len(model_types)} models for {hazard_type}")
        
        return results
    
    def compare_model_results(self, results: List[Dict[str, Any]]) -> pd.DataFrame:
        """
        Compare results from multiple trained models.
        
        Args:
            results: List of training results
        
        Returns:
            DataFrame with model comparison
        """
        comparison_data = []
        
        for result in results:
            row = {
                'model_type': result['model_type'],
                'hazard_type': result['hazard_type']
            }
            row.update(result.get('metrics', {}))
            comparison_data.append(row)
        
        comparison_df = pd.DataFrame(comparison_data)
        
        return comparison_df

