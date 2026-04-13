"""
Module: autonomous/__init__.py

Package initialiser for the autonomous module (makes Python treat this directory as an importable package).
"""
from .discovery_agent import AutonomousDataDiscoveryAgent
from .ingestion_engine import DatasetIngestionEngine
from .feature_processor import FeatureEngineeringProcessor
from .training_orchestrator import TrainingOrchestrator
from .evaluator import ModelEvaluator
from .registry_manager import ModelRegistryManager
from .drift_detector import DriftDetector
from .autonomous_engine import AutonomousAIEngine

__all__ = [
    "AutonomousDataDiscoveryAgent",
    "DatasetIngestionEngine",
    "FeatureEngineeringProcessor",
    "TrainingOrchestrator",
    "ModelEvaluator",
    "ModelRegistryManager",
    "DriftDetector",
    "AutonomousAIEngine",
]
