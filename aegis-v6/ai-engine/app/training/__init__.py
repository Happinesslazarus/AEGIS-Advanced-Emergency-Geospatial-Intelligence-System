"""
Package initialiser for the training module (makes Python treat this directory
as an importable package).

Lazy-guard: sub-modules depend on heavyweight runtime packages (asyncpg, mlflow,
etc.) that may not be installed in all environments.  Importing them here is
optional; individual training scripts import what they need directly.
"""

# Lazy-guard imports — silently skip if optional dependencies are absent.
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
