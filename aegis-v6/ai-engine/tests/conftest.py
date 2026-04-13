"""
Module: conftest.py

Conftest AI engine module.
"""

import sys
import os
from pathlib import Path

import pytest

# Ensure the ai-engine package root is importable
AI_ENGINE_ROOT = Path(__file__).resolve().parent.parent
if str(AI_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ENGINE_ROOT))

@pytest.fixture(scope="session")
def report_classifier():
    """Shared ReportClassifier instance."""
    from app.models.report_classifier import ReportClassifier
    return ReportClassifier()

@pytest.fixture(scope="session")
def fake_detector():
    """Shared FakeDetector instance."""
    from app.models.fake_detector import FakeDetector
    return FakeDetector()

@pytest.fixture(scope="session")
def severity_predictor():
    """Shared SeverityPredictor instance pinned to heuristic mode for deterministic tests."""
    from app.models.severity_predictor import SeverityPredictor
    predictor = SeverityPredictor()
    # Force heuristic path even if a local trained model artifact is present.
    predictor.model = None
    predictor.vectorizer = None
    predictor.model_version = "heuristic-v1.0"
    return predictor
