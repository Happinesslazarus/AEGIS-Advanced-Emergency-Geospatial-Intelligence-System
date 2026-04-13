"""
File: hyperparameter_tuner.py

What this file does:
Optuna-based hyperparameter optimisation wrapper. Defines search spaces
for RandomForest, GradientBoosting, and XGBoost models, runs N trials
(configurable), and returns the best parameters. Integrated as an optional
step in training_pipeline.py.

How it connects:
- Called by training_pipeline.py when ENABLE_HYPERPARAMETER_TUNING=true
- Optuna storage backend: SQLite file in ai-engine/data/optuna.db
- Best params passed to model_trainer.py for final training run
"""

# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# Optuna-based hyperparameter optimization:
# - Bayesian optimization
# - Pruning underperforming trials
# - Multi-objective optimization
# - Integration with MLflow tracking
# -------------------------------------------------------------------------------

from __future__ import annotations

try:
    import optuna
    OPTUNA_AVAILABLE = True
except ImportError:
    optuna = None
    OPTUNA_AVAILABLE = False
from typing import Dict, Any, Callable, Optional, List
from loguru import logger
import yaml
import numpy as np

class HyperparameterTuner:
    """
    Automated hyperparameter tuning using Optuna.
    Implements config.yaml training.hyperparameter_tuning settings.
    """
    
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize hyperparameter tuner with configuration."""
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        self.tuning_config = self.config['training']['hyperparameter_tuning']
        self.enabled = self.tuning_config.get('enabled', True) and OPTUNA_AVAILABLE
        self.method = self.tuning_config.get('method', 'optuna')
        self.n_trials = self.tuning_config.get('n_trials', 100)
        self.timeout = self.tuning_config.get('timeout', 3600)
        
        if not OPTUNA_AVAILABLE:
            logger.warning("Optuna not installed - hyperparameter tuning disabled")

        # Random seed for reproducibility
        self.seed = self.config['training']['reproducibility']['random_seed']
    
    def suggest_xgboost_params(self, trial: optuna.Trial) -> Dict[str, Any]:
        """
        Suggest hyperparameters for XGBoost model.
        
        Args:
            trial: Optuna trial object
        
        Returns:
            Dictionary of hyperparameters
        """
        params = {
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'n_estimators': trial.suggest_int('n_estimators', 50, 500),
            'min_child_weight': trial.suggest_int('min_child_weight', 1, 10),
            'gamma': trial.suggest_float('gamma', 0.0, 1.0),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0),
            'reg_alpha': trial.suggest_float('reg_alpha', 0.0, 1.0),
            'reg_lambda': trial.suggest_float('reg_lambda', 0.0, 1.0),
            'random_state': self.seed
        }
        return params
    
    def suggest_lightgbm_params(self, trial: optuna.Trial) -> Dict[str, Any]:
        """
        Suggest hyperparameters for LightGBM model.
        
        Args:
            trial: Optuna trial object
        
        Returns:
            Dictionary of hyperparameters
        """
        params = {
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'n_estimators': trial.suggest_int('n_estimators', 50, 500),
            'num_leaves': trial.suggest_int('num_leaves', 20, 150),
            'min_child_samples': trial.suggest_int('min_child_samples', 5, 100),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0),
            'reg_alpha': trial.suggest_float('reg_alpha', 0.0, 1.0),
            'reg_lambda': trial.suggest_float('reg_lambda', 0.0, 1.0),
            'random_state': self.seed,
            'verbose': -1
        }
        return params
    
    def suggest_catboost_params(self, trial: optuna.Trial) -> Dict[str, Any]:
        """
        Suggest hyperparameters for CatBoost model.
        
        Args:
            trial: Optuna trial object
        
        Returns:
            Dictionary of hyperparameters
        """
        params = {
            'depth': trial.suggest_int('depth', 4, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'iterations': trial.suggest_int('iterations', 50, 500),
            'l2_leaf_reg': trial.suggest_float('l2_leaf_reg', 1.0, 10.0),
            'border_count': trial.suggest_int('border_count', 32, 255),
            'bagging_temperature': trial.suggest_float('bagging_temperature', 0.0, 1.0),
            'random_strength': trial.suggest_float('random_strength', 0.0, 1.0),
            'random_state': self.seed,
            'verbose': False
        }
        return params
    
    def suggest_random_forest_params(self, trial: optuna.Trial) -> Dict[str, Any]:
        """
        Suggest hyperparameters for Random Forest model.
        
        Args:
            trial: Optuna trial object
        
        Returns:
            Dictionary of hyperparameters
        """
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 50, 500),
            'max_depth': trial.suggest_int('max_depth', 3, 20),
            'min_samples_split': trial.suggest_int('min_samples_split', 2, 20),
            'min_samples_leaf': trial.suggest_int('min_samples_leaf', 1, 10),
            'max_features': trial.suggest_categorical('max_features', ['sqrt', 'log2', None]),
            'bootstrap': trial.suggest_categorical('bootstrap', [True, False]),
            'random_state': self.seed
        }
        return params
    
    def suggest_lstm_params(self, trial: optuna.Trial) -> Dict[str, Any]:
        """
        Suggest hyperparameters for LSTM model.
        
        Args:
            trial: Optuna trial object
        
        Returns:
            Dictionary of hyperparameters
        """
        params = {
            'hidden_size': trial.suggest_categorical('hidden_size', [32, 64, 128, 256]),
            'num_layers': trial.suggest_int('num_layers', 1, 4),
            'dropout': trial.suggest_float('dropout', 0.0, 0.5),
            'learning_rate': trial.suggest_float('learning_rate', 1e-4, 1e-2, log=True),
            'batch_size': trial.suggest_categorical('batch_size', [16, 32, 64, 128]),
            'epochs': trial.suggest_int('epochs', 10, 100),
            'patience': trial.suggest_int('patience', 5, 20)
        }
        return params
    
    def optimize(
        self,
        objective_fn: Callable,
        model_type: str,
        direction: str = "maximize",
        n_trials: Optional[int] = None,
        timeout: Optional[int] = None,
        study_name: Optional[str] = None
    ) -> optuna.Study:
        """
        Run hyperparameter optimization.
        
        Args:
            objective_fn: Objective function to optimize (takes trial as argument)
            model_type: Type of model being tuned
            direction: "maximize" or "minimize"
            n_trials: Number of trials (overrides config)
            timeout: Timeout in seconds (overrides config)
            study_name: Name for the study
        
        Returns:
            Completed Optuna study
        """
        if not self.enabled:
            logger.warning("Hyperparameter tuning is disabled in config")
            return None
        
        if n_trials is None:
            n_trials = self.n_trials
        
        if timeout is None:
            timeout = self.timeout
        
        if study_name is None:
            study_name = f"aegis_{model_type}_tuning"
        
        logger.info(f"Starting hyperparameter tuning for {model_type}")
        logger.info(f"Trials: {n_trials}, Timeout: {timeout}s, Direction: {direction}")
        
        # Create Optuna study
        sampler = optuna.samplers.TPESampler(seed=self.seed)
        pruner = optuna.pruners.MedianPruner(
            n_startup_trials=10,
            n_warmup_steps=20,
            interval_steps=10
        )
        
        study = optuna.create_study(
            study_name=study_name,
            direction=direction,
            sampler=sampler,
            pruner=pruner
        )
        
        # Run optimization
        try:
            study.optimize(
                objective_fn,
                n_trials=n_trials,
                timeout=timeout,
                show_progress_bar=True,
                n_jobs=1  # Sequential for stability
            )
            
            logger.success(f"Optimization complete. Best value: {study.best_value:.4f}")
            logger.info(f"Best parameters: {study.best_params}")
            
            # Log optimization statistics
            self._log_study_stats(study)
            
        except Exception as e:
            logger.error(f"Optimization failed: {e}")
            raise
        
        return study
    
    def _log_study_stats(self, study: optuna.Study):
        """Log study statistics."""
        logger.info(f"Total trials: {len(study.trials)}")
        logger.info(f"Completed trials: {len([t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE])}")
        logger.info(f"Pruned trials: {len([t for t in study.trials if t.state == optuna.trial.TrialState.PRUNED])}")
        logger.info(f"Failed trials: {len([t for t in study.trials if t.state == optuna.trial.TrialState.FAIL])}")
    
    def get_best_params(
        self,
        study: optuna.Study,
        model_type: str
    ) -> Dict[str, Any]:
        """
        Get best parameters from study.
        
        Args:
            study: Completed Optuna study
            model_type: Type of model
        
        Returns:
            Dictionary of best hyperparameters
        """
        if study is None:
            logger.warning("Study is None, returning default parameters")
            return self.get_default_params(model_type)
        
        return study.best_params
    
    def get_default_params(self, model_type: str) -> Dict[str, Any]:
        """
        Get default parameters for a model type.
        
        Args:
            model_type: Type of model
        
        Returns:
            Dictionary of default hyperparameters
        """
        defaults = {
            'xgboost': {
                'max_depth': 6,
                'learning_rate': 0.1,
                'n_estimators': 100,
                'min_child_weight': 1,
                'gamma': 0.0,
                'subsample': 0.8,
                'colsample_bytree': 0.8,
                'reg_alpha': 0.0,
                'reg_lambda': 1.0,
                'random_state': self.seed
            },
            'lightgbm': {
                'max_depth': 6,
                'learning_rate': 0.1,
                'n_estimators': 100,
                'num_leaves': 31,
                'min_child_samples': 20,
                'subsample': 0.8,
                'colsample_bytree': 0.8,
                'reg_alpha': 0.0,
                'reg_lambda': 0.0,
                'random_state': self.seed,
                'verbose': -1
            },
            'catboost': {
                'depth': 6,
                'learning_rate': 0.1,
                'iterations': 100,
                'l2_leaf_reg': 3.0,
                'border_count': 128,
                'bagging_temperature': 1.0,
                'random_state': self.seed,
                'verbose': False
            },
            'random_forest': {
                'n_estimators': 100,
                'max_depth': 10,
                'min_samples_split': 2,
                'min_samples_leaf': 1,
                'random_state': self.seed
            },
            'lstm': {
                'hidden_size': 64,
                'num_layers': 2,
                'dropout': 0.2,
                'learning_rate': 0.001,
                'batch_size': 32,
                'epochs': 50,
                'patience': 10
            }
        }
        
        return defaults.get(model_type, {})
    
    def create_objective_fn(
        self,
        model_type: str,
        train_fn: Callable,
        X_train: Any,
        y_train: Any,
        X_val: Any,
        y_val: Any,
        metric_fn: Callable
    ) -> Callable:
        """
        Create objective function for Optuna.
        
        Args:
            model_type: Type of model
            train_fn: Function to train model (takes params as argument)
            X_train: Training features
            y_train: Training labels
            X_val: Validation features
            y_val: Validation labels
            metric_fn: Function to calculate metric (takes y_true, y_pred)
        
        Returns:
            Objective function for Optuna
        """
        def objective(trial: optuna.Trial) -> float:
            # Suggest parameters based on model type
            if model_type == 'xgboost':
                params = self.suggest_xgboost_params(trial)
            elif model_type == 'lightgbm':
                params = self.suggest_lightgbm_params(trial)
            elif model_type == 'catboost':
                params = self.suggest_catboost_params(trial)
            elif model_type == 'random_forest':
                params = self.suggest_random_forest_params(trial)
            elif model_type == 'lstm':
                params = self.suggest_lstm_params(trial)
            else:
                raise ValueError(f"Unsupported model type: {model_type}")
            
            # Train model with suggested parameters
            try:
                model = train_fn(params, X_train, y_train)
                
                # Evaluate on validation set
                y_pred = model.predict(X_val) if hasattr(model, 'predict') else model(X_val)
                
                # Calculate metric
                metric_value = metric_fn(y_val, y_pred)
                
                return metric_value
            
            except Exception as e:
                logger.warning(f"Trial {trial.number} failed: {e}")
                raise optuna.TrialPruned()
        
        return objective

