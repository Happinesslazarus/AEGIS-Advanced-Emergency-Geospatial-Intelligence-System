"""
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 AEGIS AI ENGINE â€” Model Trainer
 
 Unified training interface for:
 - Gradient Boosting (XGBoost, LightGBM, CatBoost)
 - Random Forest
 - Deep Learning (LSTM, Transformer)
 - Ensemble Methods
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple, Optional, List
from loguru import logger
import yaml
import joblib
from pathlib import Path

# ML Libraries
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import TimeSeriesSplit

try:
    import xgboost as xgb
    XGBOOST_AVAILABLE = True
except ImportError:
    xgb = None
    XGBOOST_AVAILABLE = False

try:
    import lightgbm as lgb
    LIGHTGBM_AVAILABLE = True
except ImportError:
    lgb = None
    LIGHTGBM_AVAILABLE = False

try:
    from catboost import CatBoostClassifier, CatBoostRegressor
    CATBOOST_AVAILABLE = True
except ImportError:
    CatBoostClassifier = None
    CatBoostRegressor = None
    CATBOOST_AVAILABLE = False

# Deep Learning (optional imports)
try:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available, deep learning models disabled")


class ModelTrainer:
    """
    Unified interface for training different model types.
    Implements config.yaml model specifications.
    """
    
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize model trainer with configuration."""
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        self.seed = self.config['training']['reproducibility']['random_seed']
        self.validation_config = self.config['training']['validation']
    
    def train_xgboost(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: Optional[pd.DataFrame] = None,
        y_val: Optional[pd.Series] = None,
        params: Optional[Dict[str, Any]] = None,
        task: str = 'classification'
    ) -> xgb.Booster:
        """
        Train XGBoost model.
        
        Args:
            X_train: Training features
            y_train: Training labels
            X_val: Validation features
            y_val: Validation labels
            params: Hyperparameters
            task: 'classification' or 'regression'
        
        Returns:
            Trained XGBoost model
        """
        if not XGBOOST_AVAILABLE:
            raise ImportError("xgboost is not installed in the current environment")

        logger.info("Training XGBoost model")
        
        # Default parameters
        default_params = {
            'max_depth': 6,
            'learning_rate': 0.1,
            'n_estimators': 100,
            'objective': 'binary:logistic' if task == 'classification' else 'reg:squarederror',
            'eval_metric': 'auc' if task == 'classification' else 'rmse',
            'tree_method': 'hist',
            'random_state': self.seed
        }
        
        if params:
            default_params.update(params)
        
        # Convert to DMatrix
        dtrain = xgb.DMatrix(X_train, label=y_train)
        evals = [(dtrain, 'train')]
        
        if X_val is not None and y_val is not None:
            dval = xgb.DMatrix(X_val, label=y_val)
            evals.append((dval, 'val'))
        
        # Train model
        model = xgb.train(
            default_params,
            dtrain,
            num_boost_round=default_params.pop('n_estimators', 100),
            evals=evals,
            early_stopping_rounds=20 if X_val is not None else None,
            verbose_eval=False
        )
        
        logger.success(f"XGBoost training complete (best iteration: {model.best_iteration if hasattr(model, 'best_iteration') else 'N/A'})")
        
        return model
    
    def train_lightgbm(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: Optional[pd.DataFrame] = None,
        y_val: Optional[pd.Series] = None,
        params: Optional[Dict[str, Any]] = None,
        task: str = 'classification'
    ) -> lgb.Booster:
        """
        Train LightGBM model.
        
        Args:
            X_train: Training features
            y_train: Training labels
            X_val: Validation features
            y_val: Validation labels
            params: Hyperparameters
            task: 'classification' or 'regression'
        
        Returns:
            Trained LightGBM model
        """
        if not LIGHTGBM_AVAILABLE:
            raise ImportError("lightgbm is not installed in the current environment")

        logger.info("Training LightGBM model")
        
        # Default parameters
        default_params = {
            'objective': 'binary' if task == 'classification' else 'regression',
            'metric': 'auc' if task == 'classification' else 'rmse',
            'boosting_type': 'gbdt',
            'num_leaves': 31,
            'learning_rate': 0.1,
            'n_estimators': 100,
            'random_state': self.seed,
            'verbose': -1
        }
        
        if params:
            default_params.update(params)
        
        # Create dataset
        train_data = lgb.Dataset(X_train, label=y_train)
        valid_sets = [train_data]
        
        if X_val is not None and y_val is not None:
            val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)
            valid_sets.append(val_data)
        
        # Train model
        model = lgb.train(
            default_params,
            train_data,
            num_boost_round=default_params.pop('n_estimators', 100),
            valid_sets=valid_sets,
            callbacks=[
                lgb.early_stopping(stopping_rounds=20, verbose=False)
            ] if X_val is not None else None
        )
        
        logger.success(f"LightGBM training complete (best iteration: {model.best_iteration if hasattr(model, 'best_iteration') else 'N/A'})")
        
        return model
    
    def train_catboost(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: Optional[pd.DataFrame] = None,
        y_val: Optional[pd.Series] = None,
        params: Optional[Dict[str, Any]] = None,
        task: str = 'classification'
    ):
        """
        Train CatBoost model.
        
        Args:
            X_train: Training features
            y_train: Training labels
            X_val: Validation features
            y_val: Validation labels
            params: Hyperparameters
            task: 'classification' or 'regression'
        
        Returns:
            Trained CatBoost model
        """
        if not CATBOOST_AVAILABLE:
            raise ImportError("catboost is not installed in the current environment")

        logger.info("Training CatBoost model")
        
        # Default parameters
        default_params = {
            'iterations': 100,
            'depth': 6,
            'learning_rate': 0.1,
            'loss_function': 'Logloss' if task == 'classification' else 'RMSE',
            'random_seed': self.seed,
            'verbose': False
        }
        
        if params:
            default_params.update(params)
        
        # Initialize model
        if task == 'classification':
            model = CatBoostClassifier(**default_params)
        else:
            model = CatBoostRegressor(**default_params)
        
        # Prepare validation data
        eval_set = None
        if X_val is not None and y_val is not None:
            eval_set = (X_val, y_val)
        
        # Train model
        model.fit(
            X_train, y_train,
            eval_set=eval_set,
            early_stopping_rounds=20 if eval_set else None,
            verbose=False
        )
        
        logger.success(f"CatBoost training complete (iterations: {model.get_best_iteration() if eval_set else default_params['iterations']})")
        
        return model
    
    def train_random_forest(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        params: Optional[Dict[str, Any]] = None,
        task: str = 'classification'
    ):
        """
        Train Random Forest model.
        
        Args:
            X_train: Training features
            y_train: Training labels
            params: Hyperparameters
            task: 'classification' or 'regression'
        
        Returns:
            Trained Random Forest model
        """
        logger.info("Training Random Forest model")
        
        # Default parameters
        default_params = {
            'n_estimators': 100,
            'max_depth': 10,
            'random_state': self.seed,
            'n_jobs': -1
        }
        
        if params:
            default_params.update(params)
        
        # Initialize model
        if task == 'classification':
            model = RandomForestClassifier(**default_params)
        else:
            model = RandomForestRegressor(**default_params)
        
        # Train model
        model.fit(X_train, y_train)
        
        logger.success(f"Random Forest training complete ({default_params['n_estimators']} trees)")
        
        return model
    
    def train_lstm(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None,
        params: Optional[Dict[str, Any]] = None
    ):
        """
        Train LSTM model.
        
        Args:
            X_train: Training sequences (3D: samples x timesteps x features)
            y_train: Training labels
            X_val: Validation sequences
            y_val: Validation labels
            params: Hyperparameters
        
        Returns:
            Trained LSTM model
        """
        if not TORCH_AVAILABLE:
            raise ImportError("PyTorch is required for LSTM training")
        
        logger.info("Training LSTM model")
        
        # Default parameters
        default_params = {
            'input_size': X_train.shape[2],
            'hidden_size': 64,
            'num_layers': 2,
            'dropout': 0.2,
            'learning_rate': 0.001,
            'batch_size': 32,
            'epochs': 50,
            'patience': 10
        }
        
        if params:
            default_params.update(params)
        
        # Define LSTM model
        class LSTMModel(nn.Module):
            def __init__(self, input_size, hidden_size, num_layers, dropout):
                super().__init__()
                self.lstm = nn.LSTM(
                    input_size, hidden_size, num_layers,
                    dropout=dropout, batch_first=True
                )
                self.fc = nn.Linear(hidden_size, 1)
            
            def forward(self, x):
                lstm_out, _ = self.lstm(x)
                output = self.fc(lstm_out[:, -1, :])
                return output.squeeze()
        
        # Initialize model
        model = LSTMModel(
            default_params['input_size'],
            default_params['hidden_size'],
            default_params['num_layers'],
            default_params['dropout']
        )
        
        # Training setup
        criterion = nn.BCEWithLogitsLoss()
        optimizer = torch.optim.Adam(model.parameters(), lr=default_params['learning_rate'])
        
        # Create DataLoaders
        train_dataset = TensorDataset(
            torch.FloatTensor(X_train),
            torch.FloatTensor(y_train)
        )
        train_loader = DataLoader(
            train_dataset,
            batch_size=default_params['batch_size'],
            shuffle=True
        )
        
        # Training loop
        best_val_loss = float('inf')
        patience_counter = 0
        
        for epoch in range(default_params['epochs']):
            model.train()
            train_loss = 0.0
            
            for batch_X, batch_y in train_loader:
                optimizer.zero_grad()
                outputs = model(batch_X)
                loss = criterion(outputs, batch_y)
                loss.backward()
                optimizer.step()
                train_loss += loss.item()
            
            avg_train_loss = train_loss / len(train_loader)
            
            # Validation
            if X_val is not None and y_val is not None:
                model.eval()
                with torch.no_grad():
                    val_outputs = model(torch.FloatTensor(X_val))
                    val_loss = criterion(val_outputs, torch.FloatTensor(y_val)).item()
                
                # Early stopping
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    patience_counter = 0
                else:
                    patience_counter += 1
                
                if patience_counter >= default_params['patience']:
                    logger.info(f"Early stopping at epoch {epoch}")
                    break
        
        logger.success(f"LSTM training complete ({epoch + 1} epochs)")
        
        return model
    
    def save_model(self, model: Any, path: str, model_type: str):
        """
        Save trained model to disk.
        
        Args:
            model: Trained model
            path: Save path
            model_type: Type of model
        """
        save_path = Path(path)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        
        if model_type in ['xgboost', 'lightgbm']:
            model.save_model(str(save_path))
        elif model_type in ['catboost', 'random_forest']:
            joblib.dump(model, save_path)
        elif model_type == 'lstm' and TORCH_AVAILABLE:
            torch.save(model.state_dict(), save_path)
        else:
            joblib.dump(model, save_path)
        
        logger.success(f"Model saved to {save_path}")
    
    def load_model(self, path: str, model_type: str) -> Any:
        """
        Load trained model from disk.
        
        Args:
            path: Model file path
            model_type: Type of model
        
        Returns:
            Loaded model
        """
        if model_type == 'xgboost':
            model = xgb.Booster()
            model.load_model(path)
        elif model_type == 'lightgbm':
            model = lgb.Booster(model_file=path)
        elif model_type in ['catboost', 'random_forest']:
            model = joblib.load(path)
        elif model_type == 'lstm' and TORCH_AVAILABLE:
            # Need model architecture to load state_dict
            logger.warning("LSTM loading requires model architecture - returning None")
            return None
        else:
            model = joblib.load(path)
        
        logger.success(f"Model loaded from {path}")
        return model

