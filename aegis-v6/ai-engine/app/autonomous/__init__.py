"""
Autonomous AI Engine Module

Fully autonomous system that:
- Discovers datasets from PostgreSQL
- Ingests real historical data
- Trains models automatically
- Evaluates performance
- Updates model registry
- Detects drift and retrains
- Enforces safety constraints
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
