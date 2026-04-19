"""
Lightweight experiment tracker (no MLflow dependency). Saves training
run metadata -- hyperparameters, metrics, model version, timestamp --
as a JSON file per run in ai-engine/data/experiments/. Provides
experiment comparison utilities for selecting the best run.

- Called by training_pipeline.py at the end of every training run
- Experiment JSON files readable by evaluator.py for comparison
- Results surfaced in Admin panel via server/src/routes/adminRoutes.ts
"""

# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# -------------------------------------------------------------------------------
# MLflow-based experiment tracking for:
# - Model training runs
# - Hyperparameter configurations
# - Performance metrics
# - Model artifacts
# - Reproducibility
# -------------------------------------------------------------------------------

try:
    import mlflow
    import mlflow.sklearn
    import mlflow.pytorch
    import mlflow.tensorflow
    MLFLOW_AVAILABLE = True
except ImportError:
    mlflow = None
    MLFLOW_AVAILABLE = False
from typing import Dict, Any, Optional, List
from loguru import logger
from pathlib import Path
import yaml
import json
from datetime import datetime

class ExperimentTracker:
    """
    Track machine learning experiments using MLflow.
    Ensures full reproducibility and versioning.
    """
    
    def __init__(self, config_path: str = "config.yaml", tracking_uri: Optional[str] = None):
        """
        Initialize experiment tracker.
        
        Args:
            config_path: Path to configuration file
            tracking_uri: MLflow tracking URI (default: local ./mlruns)
        """
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        self.enabled = MLFLOW_AVAILABLE
        self.experiment_name = "AEGIS-AI-Training"

        if not self.enabled:
            logger.warning("MLflow not installed - experiment tracking disabled")
            self.experiment_id = None
            return
        
        # Set MLflow tracking URI
        if tracking_uri is None:
            tracking_uri = "file:./mlruns"
        
        mlflow.set_tracking_uri(tracking_uri)
        logger.info(f"MLflow tracking URI: {tracking_uri}")
        
        # Create experiment if it doesn't exist
        
        try:
            self.experiment = mlflow.get_experiment_by_name(self.experiment_name)
            if self.experiment is None:
                self.experiment_id = mlflow.create_experiment(
                    self.experiment_name,
                    tags={
                        "project": "AEGIS",
                        "version": self.config['system']['version'],
                        "region": self.config['system']['deployment_region']
                    }
                )
            else:
                self.experiment_id = self.experiment.experiment_id
            
            mlflow.set_experiment(self.experiment_name)
            logger.success(f"MLflow experiment '{self.experiment_name}' initialized")
        
        except Exception as e:
            logger.warning(f"Failed to initialize MLflow experiment: {e}")
            self.experiment_id = None
    
    def start_run(
        self,
        run_name: str,
        hazard_type: str,
        model_type: str,
        tags: Optional[Dict[str, str]] = None
    ) -> Any:
        """
        Start a new MLflow run.
        
        Args:
            run_name: Name for this run
            hazard_type: Type of hazard ('flood', 'drought', 'heatwave')
            model_type: Type of model ('xgboost', 'lstm', etc.)
            tags: Additional tags
        
        Returns:
            MLflow run context
        """
        default_tags = {
            "hazard_type": hazard_type,
            "model_type": model_type,
            "timestamp": datetime.now().isoformat(),
            "environment": self.config['system']['environment']
        }
        
        if tags:
            default_tags.update(tags)

        if not self.enabled:
            return None
        
        run = mlflow.start_run(run_name=run_name, tags=default_tags)
        
        logger.info(f"Started MLflow run: {run_name} (ID: {run.info.run_id})")
        
        return run
    
    def log_params(self, params: Dict[str, Any]):
        """
        Log training parameters.
        
        Args:
            params: Dictionary of parameters
        """
        try:
            if not self.enabled:
                return
            # MLflow has limits on parameter values, so convert complex types
            flat_params = {}
            for key, value in params.items():
                if isinstance(value, (dict, list)):
                    flat_params[key] = json.dumps(value)
                else:
                    flat_params[key] = value
            
            mlflow.log_params(flat_params)
            logger.debug(f"Logged {len(flat_params)} parameters")
        
        except Exception as e:
            logger.warning(f"Failed to log parameters: {e}")
    
    def log_metrics(self, metrics: Dict[str, float], step: Optional[int] = None):
        """
        Log evaluation metrics.
        
        Args:
            metrics: Dictionary of metric name -> value
            step: Optional step number (for multiple evaluations)
        """
        try:
            if not self.enabled:
                return
            mlflow.log_metrics(metrics, step=step)
            logger.debug(f"Logged {len(metrics)} metrics")
        
        except Exception as e:
            logger.warning(f"Failed to log metrics: {e}")
    
    def log_model(
        self,
        model: Any,
        artifact_path: str,
        model_type: str = "sklearn",
        **kwargs
    ):
        """
        Log trained model as artifact.
        
        Args:
            model: Trained model object
            artifact_path: Path within MLflow artifact store
            model_type: Type of model ('sklearn', 'pytorch', 'tensorflow')
            **kwargs: Additional arguments for model logging
        """
        try:
            if not self.enabled:
                return
            if model_type == "sklearn":
                mlflow.sklearn.log_model(model, artifact_path, **kwargs)
            elif model_type == "pytorch":
                mlflow.pytorch.log_model(model, artifact_path, **kwargs)
            elif model_type == "tensorflow":
                mlflow.tensorflow.log_model(model, artifact_path, **kwargs)
            else:
                logger.warning(f"Unsupported model type: {model_type}, using pickle fallback")
                mlflow.log_artifact(artifact_path)
            
            logger.success(f"Logged {model_type} model to {artifact_path}")
        
        except Exception as e:
            logger.error(f"Failed to log model: {e}")
    
    def log_artifact(self, local_path: str, artifact_path: Optional[str] = None):
        """
        Log arbitrary artifact (plots, data files, etc.).
        
        Args:
            local_path: Path to local file
            artifact_path: Optional path within artifact store
        """
        try:
            if not self.enabled:
                return
            mlflow.log_artifact(local_path, artifact_path)
            logger.debug(f"Logged artifact: {local_path}")
        
        except Exception as e:
            logger.warning(f"Failed to log artifact: {e}")
    
    def log_figure(self, figure: Any, filename: str):
        """
        Log matplotlib/plotly figure.
        
        Args:
            figure: Matplotlib or Plotly figure
            filename: Filename for the figure
        """
        try:
            if not self.enabled:
                return
            temp_path = Path(f"/tmp/{filename}")
            figure.savefig(temp_path, dpi=150, bbox_inches='tight')
            mlflow.log_artifact(str(temp_path))
            temp_path.unlink()
            
            logger.debug(f"Logged figure: {filename}")
        
        except Exception as e:
            logger.warning(f"Failed to log figure: {e}")
    
    def log_dataset_info(self, dataset_info: Dict[str, Any]):
        """
        Log dataset information and statistics.
        
        Args:
            dataset_info: Dictionary with dataset metadata
        """
        try:
            if not self.enabled:
                return
            # Log as parameters
            self.log_params({"dataset_" + k: v for k, v in dataset_info.items() if not isinstance(v, (dict, list))})
            
            # Log full info as JSON artifact
            temp_path = Path("/tmp/dataset_info.json")
            with open(temp_path, 'w') as f:
                json.dump(dataset_info, f, indent=2, default=str)
            
            mlflow.log_artifact(str(temp_path))
            temp_path.unlink()
            
            logger.debug("Logged dataset information")
        
        except Exception as e:
            logger.warning(f"Failed to log dataset info: {e}")
    
    def log_feature_importance(
        self,
        feature_names: List[str],
        importance_values: List[float],
        importance_type: str = "gain"
    ):
        """
        Log feature importance.
        
        Args:
            feature_names: List of feature names
            importance_values: Corresponding importance values
            importance_type: Type of importance ('gain', 'split', 'shap')
        """
        try:
            if not self.enabled:
                return
            # Create DataFrame for structured logging
            import pandas as pd
            
            importance_df = pd.DataFrame({
                'feature': feature_names,
                'importance': importance_values,
                'type': importance_type
            }).sort_values('importance', ascending=False)
            
            # Save as CSV artifact
            temp_path = Path(f"/tmp/feature_importance_{importance_type}.csv")
            importance_df.to_csv(temp_path, index=False)
            mlflow.log_artifact(str(temp_path))
            temp_path.unlink()
            
            # Log top 10 as metrics
            for idx, row in importance_df.head(10).iterrows():
                mlflow.log_metric(f"importance_{row['feature']}", row['importance'])
            
            logger.debug(f"Logged feature importance ({importance_type})")
        
        except Exception as e:
            logger.warning(f"Failed to log feature importance: {e}")
    
    def end_run(self):
        """End current MLflow run."""
        try:
            if not self.enabled:
                return
            mlflow.end_run()
            logger.info("Ended MLflow run")
        except Exception as e:
            logger.warning(f"Failed to end MLflow run: {e}")
    
    def get_best_run(
        self,
        metric_name: str,
        hazard_type: Optional[str] = None,
        ascending: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Get best run by metric.
        
        Args:
            metric_name: Metric to optimize
            hazard_type: Filter by hazard type
            ascending: True for minimization, False for maximization
        
        Returns:
            Dictionary with run info and metrics
        """
        try:
            if not self.enabled:
                return None
            # Build filter string
            filter_string = ""
            if hazard_type:
                filter_string = f"tags.hazard_type = '{hazard_type}'"
            
            # Search runs
            runs = mlflow.search_runs(
                experiment_ids=[self.experiment_id],
                filter_string=filter_string,
                order_by=[f"metrics.{metric_name} {'ASC' if ascending else 'DESC'}"],
                max_results=1
            )
            
            if runs.empty:
                logger.warning("No runs found")
                return None
            
            best_run = runs.iloc[0].to_dict()
            logger.info(f"Best run: {best_run['run_id']} with {metric_name}={best_run.get(f'metrics.{metric_name}', 'N/A')}")
            
            return best_run
        
        except Exception as e:
            logger.error(f"Failed to get best run: {e}")
            return None
    
    def compare_runs(
        self,
        run_ids: List[str],
        metrics: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Compare multiple runs.
        
        Args:
            run_ids: List of run IDs to compare
            metrics: List of metric names to compare
        
        Returns:
            Dictionary mapping run_id -> metrics
        """
        try:
            if not self.enabled:
                return {}
            comparison = {}
            
            for run_id in run_ids:
                run = mlflow.get_run(run_id)
                comparison[run_id] = {
                    'metrics': {m: run.data.metrics.get(m) for m in metrics},
                    'params': run.data.params,
                    'tags': run.data.tags
                }
            
            logger.info(f"Compared {len(run_ids)} runs")
            return comparison
        
        except Exception as e:
            logger.error(f"Failed to compare runs: {e}")
            return {}

