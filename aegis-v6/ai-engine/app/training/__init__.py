"""
AEGIS Training Pipeline Module
"""

from .data_loaders import DataLoader, FeatureExtractor
from .feature_engineering import FeatureEngineer
from .training_pipeline import TrainingPipeline
from .experiment_tracker import ExperimentTracker
from .hyperparameter_tuner import HyperparameterTuner
from .model_trainer import ModelTrainer
from .evaluator import ModelEvaluator
"""
AEGIS Training Pipeline Module
"""

# Lazy-guard: some sub-modules depend on heavyweight runtime packages
# (asyncpg, mlflow, etc.) that may not be installed in all environments.
# Importing them here is optional; the core training scripts and
# validate_models.py import what they need directly.
try:
    from .data_loaders import DataLoader, FeatureExtractor
except ImportError:
    pass
try:
    from .feature_engineering import FeatureEngineer
except ImportError:
    pass
try:
    from .training_pipeline import TrainingPipeline
except ImportError:
    pass
try:
    from .experiment_tracker import ExperimentTracker
except ImportError:
    pass
try:
    from .hyperparameter_tuner import HyperparameterTuner
except ImportError:
    pass
try:
    from .model_trainer import ModelTrainer
except ImportError:
    pass
try:
    from .evaluator import ModelEvaluator
except ImportError:
    pass
