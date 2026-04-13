"""
File: evaluator.py

What this file does:
Batch evaluator that runs evaluate.py across all trained hazard models,
compares them against production baselines, and produces a summary report
(JSON + HTML). Used in CI/CD to gate model promotion.

How it connects:
- Invoked by ai-engine/scripts/ evaluation scripts and CI workflows
- Loads models from ModelRegistry, test data from data_ingestion.py
- Results written to ai-engine/reports/
"""

# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# Comprehensive model evaluation with:
# - Classification metrics (accuracy, precision, recall, F1, AUC)
# - Regression metrics (MAE, RMSE, MAPE, RÂ²)
# - Probabilistic metrics (calibration, Brier score)
# - Explainability (SHAP, LIME, feature importance)
# -------------------------------------------------------------------------------

import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple, Optional
from loguru import logger
import yaml

# Metrics
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, average_precision_score, brier_score_loss,
    log_loss, confusion_matrix, classification_report,
    mean_absolute_error, mean_squared_error, r2_score,
    mean_absolute_percentage_error
)
from sklearn.calibration import calibration_curve

# Explainability
try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    logger.warning("SHAP not available, explainability features limited")

class ModelEvaluator:
    """
    Evaluate model performance with metrics from config.yaml.
    Implements config.yaml evaluation.metrics specifications.
    """
    
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize evaluator with configuration."""
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        self.eval_config = self.config['evaluation']
        self.classification_metrics = self.eval_config['metrics']['classification']
        self.regression_metrics = self.eval_config['metrics']['regression']
        self.probabilistic_metrics = self.eval_config['metrics']['probabilistic']
    
    def evaluate_classification(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        y_prob: Optional[np.ndarray] = None
    ) -> Dict[str, float]:
        """
        Evaluate classification model.
        
        Args:
            y_true: True labels
            y_pred: Predicted labels
            y_prob: Predicted probabilities (for AUC, Brier score, etc.)
        
        Returns:
            Dictionary of metric name -> value
        """
        logger.info("Evaluating classification model")
        
        metrics = {}
        unique_classes = np.unique(y_true)
        single_class = len(unique_classes) < 2
        
        # Basic metrics
        if 'accuracy' in self.classification_metrics:
            metrics['accuracy'] = accuracy_score(y_true, y_pred)
        
        if 'precision' in self.classification_metrics:
            metrics['precision'] = precision_score(y_true, y_pred, average='binary', zero_division=0)
        
        if 'recall' in self.classification_metrics:
            metrics['recall'] = recall_score(y_true, y_pred, average='binary', zero_division=0)
        
        if 'f1_score' in self.classification_metrics:
            metrics['f1_score'] = f1_score(y_true, y_pred, average='binary', zero_division=0)
        
        # Probabilistic metrics (require y_prob)
        if y_prob is not None:
            if 'roc_auc' in self.classification_metrics:
                if single_class:
                    metrics['roc_auc'] = 0.5
                else:
                    try:
                        metrics['roc_auc'] = roc_auc_score(y_true, y_prob)
                    except Exception as e:
                        logger.warning(f"ROC AUC calculation failed: {e}")
                        metrics['roc_auc'] = 0.0
            
            if 'pr_auc' in self.classification_metrics:
                if single_class:
                    metrics['pr_auc'] = 1.0
                else:
                    try:
                        metrics['pr_auc'] = average_precision_score(y_true, y_prob)
                    except Exception as e:
                        logger.warning(f"PR AUC calculation failed: {e}")
                        metrics['pr_auc'] = 0.0
            
            if 'brier_score' in self.classification_metrics:
                metrics['brier_score'] = brier_score_loss(y_true, y_prob)
            
            if 'log_loss' in self.classification_metrics:
                # Clip probabilities to avoid log(0)
                y_prob_clipped = np.clip(y_prob, 1e-10, 1 - 1e-10)
                if single_class:
                    metrics['log_loss'] = float(np.mean(-np.log(np.where(y_true == 1, y_prob_clipped, 1 - y_prob_clipped))))
                else:
                    metrics['log_loss'] = log_loss(y_true, y_prob_clipped)
        
        # Confusion matrix derived metrics
        if 'false_alarm_rate' in self.classification_metrics or 'miss_rate' in self.classification_metrics:
            cm = confusion_matrix(y_true, y_pred)
            
            # Handle edge cases
            if cm.shape == (2, 2):
                tn, fp, fn, tp = cm.ravel()
                
                if 'false_alarm_rate' in self.classification_metrics:
                    # FAR = FP / (FP + TN)
                    metrics['false_alarm_rate'] = fp / (fp + tn) if (fp + tn) > 0 else 0.0
                
                if 'miss_rate' in self.classification_metrics:
                    # Miss rate = FN / (FN + TP)
                    metrics['miss_rate'] = fn / (fn + tp) if (fn + tp) > 0 else 0.0
        
        logger.success(f"Classification evaluation complete: {len(metrics)} metrics computed")
        
        return metrics
    
    def evaluate_regression(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray
    ) -> Dict[str, float]:
        """
        Evaluate regression model.
        
        Args:
            y_true: True values
            y_pred: Predicted values
        
        Returns:
            Dictionary of metric name -> value
        """
        logger.info("Evaluating regression model")
        
        metrics = {}
        
        if 'mae' in self.regression_metrics:
            metrics['mae'] = mean_absolute_error(y_true, y_pred)
        
        if 'rmse' in self.regression_metrics:
            metrics['rmse'] = np.sqrt(mean_squared_error(y_true, y_pred))
        
        if 'mape' in self.regression_metrics:
            # Avoid division by zero
            mask = y_true != 0
            if mask.sum() > 0:
                metrics['mape'] = mean_absolute_percentage_error(y_true[mask], y_pred[mask])
            else:
                metrics['mape'] = 0.0
        
        if 'r2_score' in self.regression_metrics:
            metrics['r2_score'] = r2_score(y_true, y_pred)
        
        logger.success(f"Regression evaluation complete: {len(metrics)} metrics computed")
        
        return metrics
    
    def evaluate_calibration(
        self,
        y_true: np.ndarray,
        y_prob: np.ndarray,
        n_bins: int = 10
    ) -> Dict[str, Any]:
        """
        Evaluate probability calibration.
        
        Args:
            y_true: True labels
            y_prob: Predicted probabilities
            n_bins: Number of calibration bins
        
        Returns:
            Dictionary with calibration metrics and data
        """
        logger.info("Evaluating probability calibration")
        
        # Calculate calibration curve
        prob_true, prob_pred = calibration_curve(
            y_true, y_prob, n_bins=n_bins, strategy='uniform'
        )
        
        # Calibration error (Expected Calibration Error)
        ece = np.mean(np.abs(prob_true - prob_pred))
        
        # Maximum Calibration Error
        mce = np.max(np.abs(prob_true - prob_pred))
        
        calibration_data = {
            'calibration_error': ece,
            'max_calibration_error': mce,
            'prob_true': prob_true.tolist(),
            'prob_pred': prob_pred.tolist(),
            'n_bins': n_bins
        }
        
        logger.success(f"Calibration evaluation complete (ECE: {ece:.4f})")
        
        return calibration_data
    
    def get_feature_importance(
        self,
        model: Any,
        feature_names: List[str],
        model_type: str
    ) -> pd.DataFrame:
        """
        Extract feature importance from model.
        
        Args:
            model: Trained model
            feature_names: List of feature names
            model_type: Type of model
        
        Returns:
            DataFrame with features and importance scores
        """
        logger.info(f"Extracting feature importance for {model_type}")
        
        importance_values = None
        importance_type = 'weight'
        
        if model_type == 'xgboost':
            # XGBoost returns dict
            importance_dict = model.get_score(importance_type='weight')
            importance_values = [importance_dict.get(f, 0.0) for f in feature_names]
        
        elif model_type == 'lightgbm':
            importance_values = model.feature_importance(importance_type='split')
        
        elif model_type == 'catboost':
            importance_values = model.get_feature_importance()
        
        elif model_type == 'random_forest':
            importance_values = model.feature_importances_
        
        else:
            logger.warning(f"Feature importance not supported for {model_type}")
            importance_values = np.zeros(len(feature_names))
        
        # Create DataFrame
        importance_df = pd.DataFrame({
            'feature': feature_names,
            'importance': importance_values
        }).sort_values('importance', ascending=False)
        
        logger.success(f"Feature importance extracted for {len(feature_names)} features")
        
        return importance_df
    
    def calculate_shap_values(
        self,
        model: Any,
        X: pd.DataFrame,
        model_type: str,
        max_samples: int = 100
    ) -> Optional[np.ndarray]:
        """
        Calculate SHAP values for explainability.
        
        Args:
            model: Trained model
            X: Feature matrix
            model_type: Type of model
            max_samples: Maximum samples for SHAP (for performance)
        
        Returns:
            SHAP values array or None if not available
        """
        if not SHAP_AVAILABLE:
            logger.warning("SHAP not available")
            return None
        
        logger.info(f"Calculating SHAP values for {model_type}")
        
        try:
            # Sample data if too large
            if len(X) > max_samples:
                X_sample = X.sample(n=max_samples, random_state=42)
            else:
                X_sample = X
            
            # Initialize explainer based on model type
            if model_type in ['xgboost', 'lightgbm', 'catboost', 'random_forest']:
                explainer = shap.TreeExplainer(model)
            else:
                explainer = shap.KernelExplainer(model.predict, X_sample)
            
            # Calculate SHAP values
            shap_values = explainer.shap_values(X_sample)
            
            logger.success(f"SHAP values calculated for {len(X_sample)} samples")
            
            return shap_values
        
        except Exception as e:
            logger.error(f"SHAP calculation failed: {e}")
            return None
    
    def generate_evaluation_report(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        y_prob: Optional[np.ndarray] = None,
        feature_importance: Optional[pd.DataFrame] = None,
        task: str = 'classification'
    ) -> Dict[str, Any]:
        """
        Generate comprehensive evaluation report.
        
        Args:
            y_true: True labels/values
            y_pred: Predicted labels/values
            y_prob: Predicted probabilities (for classification)
            feature_importance: Feature importance DataFrame
            task: 'classification' or 'regression'
        
        Returns:
            Dictionary with complete evaluation results
        """
        logger.info("Generating comprehensive evaluation report")
        
        report = {
            'task': task,
            'n_samples': len(y_true)
        }
        
        # Task-specific metrics
        if task == 'classification':
            report['metrics'] = self.evaluate_classification(y_true, y_pred, y_prob)
            
            # Add calibration if probabilities available
            if y_prob is not None:
                report['calibration'] = self.evaluate_calibration(y_true, y_prob)
            
            # Confusion matrix
            report['confusion_matrix'] = confusion_matrix(y_true, y_pred).tolist()
        
        elif task == 'regression':
            report['metrics'] = self.evaluate_regression(y_true, y_pred)
        
        # Feature importance
        if feature_importance is not None:
            report['feature_importance'] = {
                'top_10': feature_importance.head(10).to_dict('records'),
                'total_features': len(feature_importance)
            }
        
        logger.success("Evaluation report generated")
        
        return report
    
    def compare_models(
        self,
        models_results: Dict[str, Dict[str, float]],
        primary_metric: str = 'f1_score'
    ) -> pd.DataFrame:
        """
        Compare multiple models.
        
        Args:
            models_results: Dict of {model_name: {metric: value}}
            primary_metric: Metric to sort by
        
        Returns:
            DataFrame with model comparison
        """
        logger.info(f"Comparing {len(models_results)} models")
        
        comparison_df = pd.DataFrame(models_results).T
        
        if primary_metric in comparison_df.columns:
            comparison_df = comparison_df.sort_values(primary_metric, ascending=False)
        
        logger.success("Model comparison complete")
        
        return comparison_df

