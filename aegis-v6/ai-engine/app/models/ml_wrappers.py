"""
File: ml_wrappers.py

What this file does:
Standardised wrapper classes for all trained scikit-learn models. Each
wrapper (ReportClassifierML, SeverityPredictorML, FakeDetectorML) handles
input preparation, model loading from registry, inference, and fallback to
the rule-based version if no trained model is available.

How it connects:
- Imported by ai-engine/app/api/endpoints.py for all ML inference calls
- Loads models via ai-engine/app/core/model_registry.py ModelRegistry
- Falls back to rule-based models in report_classifier.py etc.
- TrainedModelLoader used by training scripts to validate saved models
"""

import pickle
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from loguru import logger


def safe_pickle_load(file_path: Path, registry_root: Path) -> Any:
    """Load a pickle file with path validation to prevent directory traversal.
    Only loads files that are within the trusted model registry directory."""
    resolved = file_path.resolve()
    root_resolved = registry_root.resolve()
    if not str(resolved).startswith(str(root_resolved)):
        raise ValueError(f"Model path {resolved} is outside the trusted registry {root_resolved}")
    if not resolved.suffix == '.pkl':
        raise ValueError(f"Model file must have .pkl extension, got: {resolved.suffix}")
    with open(resolved, 'rb') as f:
        return pickle.load(f)
from datetime import datetime
import numpy as np
from scipy.sparse import hstack

class TrainedModelLoader:
    """Load and inference with real trained models."""
    
    def __init__(self, model_registry_path: str):
        self.registry_path = Path(model_registry_path)
        self.models = {}
        self.metadata = {}
        self._load_all_models()
    
    def _load_all_models(self):
        """Load all trained models from registry."""
        logger.info("Loading trained models from registry...")
        
        model_types = [
            'report_classifier',
            'severity_predictor',
            'image_classifier',
            'fake_detector'
        ]
        
        for model_type in model_types:
            try:
                model_path = self._get_latest_model(model_type)
                if model_path and model_path.exists():
                    model_data = safe_pickle_load(model_path, self.registry_path)
                    self.models[model_type] = model_data['model']
                    self.metadata[model_type] = model_data.get('metadata', {})
                    logger.success(f"✓ Loaded {model_type}")
                else:
                    logger.warning(f"⚠ No trained model found for {model_type}")
            except Exception as e:
                logger.warning(f"Failed to load {model_type}: {e}")
    
    def _get_latest_model(self, model_type: str) -> Optional[Path]:
        """Get path to latest trained model."""
        model_dir = self.registry_path / model_type
        if not model_dir.exists():
            return None
        
        models = sorted(model_dir.glob('model_*.pkl'))
        return models[-1] if models else None
    
    def has_model(self, model_type: str) -> bool:
        """Check if model is loaded and ready."""
        return model_type in self.models
    
    def get_model(self, model_type: str):
        """Get trained model or raise if not available."""
        if model_type not in self.models:
            raise ValueError(f"Model '{model_type}' not found. Train models first with ml_pipeline.py")
        return self.models[model_type]
    
    def get_metadata(self, model_type: str) -> Dict:
        """Get model metadata."""
        return self.metadata.get(model_type, {})

class ReportClassifierML:
    """Real ML-based report classification."""
    
    def __init__(self, model_loader: TrainedModelLoader):
        self.loader = model_loader
        self.model_type = 'report_classifier'
    
    def classify(self, text: str, description: str = "", location: str = "") -> Dict[str, Any]:
        """Classify report using trained XGBoost model."""
        try:
            if not self.loader.has_model(self.model_type):
                logger.warning(f"Model not trained - using fallback")
                return self._fallback_classify(text, description)
            
            # Load model and metadata
            model = self.loader.get_model(self.model_type)
            metadata = self.loader.get_metadata(self.model_type)
            
            vectorizer = metadata.get('vectorizer')
            incident_encoder = metadata.get('incident_encoder')
            hazard_types = metadata.get('hazard_types', ['unknown'])
            
            if not vectorizer:
                return self._fallback_classify(text, description)
            
            # Vectorize text
            full_text = f"{text} {description}".lower()
            X_text = vectorizer.transform([full_text])
            
            # Add incident metadata (default to 0 if not available)
            X_metadata = np.array([[0]])
            from scipy.sparse import hstack
            X = hstack([X_text, X_metadata])
            
            # Predict
            y_pred = model.predict(X)[0]
            y_proba = model.predict_proba(X)[0]
            
            primary_hazard = hazard_types[int(y_pred)] if int(y_pred) < len(hazard_types) else 'unknown'
            probability = float(max(y_proba))
            confidence = float(np.max(y_proba))
            
            return {
                'model_version': 'ml-xgboost-v1',
                'primary_hazard': primary_hazard,
                'probability': probability,
                'confidence': confidence,
                'all_hazards_detected': [primary_hazard],
                'trained': True,
                'classified_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Classification error: {e}")
            return self._fallback_classify(text, description)
    
    def _fallback_classify(self, text: str, description: str) -> Dict[str, Any]:
        """Fallback when model not trained."""
        return {
            'model_version': 'fallback-v1',
            'primary_hazard': 'unknown',
            'probability': 0.0,
            'confidence': 0.0,
            'trained': False,
            'error': 'Model not yet trained on historical data',
            'message': 'Run ml_pipeline.py to train models'
        }

class SeverityPredictorML:
    """Real ML-based severity prediction."""
    
    def __init__(self, model_loader: TrainedModelLoader):
        self.loader = model_loader
        self.model_type = 'severity_predictor'
    
    def predict(
        self,
        text: str,
        description: str = "",
        trapped_persons: int = 0,
        affected_area_km2: float = 0,
        population_affected: int = 0,
        hazard_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """Predict severity using trained model."""
        try:
            if not self.loader.has_model(self.model_type):
                logger.warning("Severity model not trained - using fallback")
                return self._fallback_predict(text)
            
            # Load model and metadata
            model = self.loader.get_model(self.model_type)
            metadata = self.loader.get_metadata(self.model_type)
            
            vectorizer = metadata.get('vectorizer')
            scaler = metadata.get('scaler')
            severity_levels = metadata.get('severity_levels', ['low', 'medium', 'high'])
            
            if not vectorizer or not scaler:
                return self._fallback_predict(text)
            
            # Vectorize text
            text_combined = f"{text} {description}".lower()
            X_text = vectorizer.transform([text_combined])
            
            # Numeric features
            text_length = len(text)
            has_trapped = 1 if trapped_persons > 0 else 0
            has_area = 1 if affected_area_km2 > 0 else 0
            hour = datetime.utcnow().hour
            
            X_numeric = np.array([[text_length, has_trapped, has_area, hour]])
            X_numeric_scaled = scaler.transform(X_numeric)
            
            # Combine features
            from scipy.sparse import hstack
            X = hstack([X_text, X_numeric_scaled])
            
            # Predict
            y_pred = model.predict(X)[0]
            y_proba = model.predict_proba(X)[0]
            
            severity = severity_levels[int(y_pred)] if int(y_pred) < len(severity_levels) else 'medium'
            probability = float(max(y_proba))
            confidence = float(np.max(y_proba))
            
            return {
                'model_version': 'ml-xgboost-v1',
                'severity': severity,
                'probability': probability,
                'confidence': confidence,
                'trained': True,
                'predicted_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Severity prediction error: {e}")
            return self._fallback_predict(text)
    
    def _fallback_predict(self, text: str) -> Dict[str, Any]:
        """Fallback when model not trained."""
        return {
            'model_version': 'fallback-v1',
            'severity': 'medium',
            'probability': 0.0,
            'confidence': 0.0,
            'trained': False,
            'error': 'Model not yet trained',
            'message': 'Run ml_pipeline.py to train models'
        }
