"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Model Registry 
 Central registry for all trained models with versioning and lifecycle management
═══════════════════════════════════════════════════════════════════════════════
"""

from typing import Dict, List, Optional, Any
from pathlib import Path
import joblib
import json
from datetime import datetime
from loguru import logger
import os


class ModelMetadata:
    """Metadata for a registered model."""
    
    def __init__(
        self,
        name: str,
        version: str,
        hazard_type: str,
        region_id: str,
        model_path: str,
        performance_metrics: Dict[str, float],
        trained_at: datetime,
        feature_names: List[str]
    ):
        self.name = name
        self.version = version
        self.hazard_type = hazard_type
        self.region_id = region_id
        self.model_path = model_path
        self.performance_metrics = performance_metrics
        self.trained_at = trained_at
        self.feature_names = feature_names
        self.loaded_model = None
        self.prediction_count = 0
        self.total_latency = 0.0
        self.last_used = None


class ModelRegistry:
    """
    Central model registry managing all trained models.
    
    Features:
    - Automatic model discovery and loading
    - Version management
    - Model selection based on hazard + region
    - Performance tracking
    - Lazy loading with caching
    """
    
    def __init__(self, registry_path: str = "./model_registry"):
        self.registry_path = Path(registry_path)
        self.models: Dict[str, ModelMetadata] = {}
        self.registry_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Model registry initialized at: {self.registry_path}")
    
    async def load_all_models(self):
        """
        Discover and register all models in the registry directory.
        
        Expected structure:
        model_registry/
            flood_scotland_v1/
                model.pkl
                metadata.json
            drought_scotland_v1/
                model.pkl
                metadata.json
        """
        logger.info("Scanning model registry...")
        
        model_count = 0
        for model_dir in self.registry_path.iterdir():
            if not model_dir.is_dir():
                continue
            
            metadata_file = model_dir / "metadata.json"
            model_file = model_dir / "model.pkl"
            
            if not metadata_file.exists():
                logger.warning(f"No metadata found for: {model_dir.name}")
                continue
            
            try:
                with open(metadata_file, 'r') as f:
                    metadata_dict = json.load(f)
                
                # Create metadata object
                metadata = ModelMetadata(
                    name=metadata_dict.get('name', model_dir.name),
                    version=metadata_dict['version'],
                    hazard_type=metadata_dict['hazard_type'],
                    region_id=metadata_dict['region_id'],
                    model_path=str(model_file) if model_file.exists() else None,
                    performance_metrics=metadata_dict.get('performance_metrics', {}),
                    trained_at=datetime.fromisoformat(metadata_dict.get('trained_at', datetime.utcnow().isoformat())),
                    feature_names=metadata_dict.get('feature_names', [])
                )
                
                # Register model
                model_key = self._get_model_key(
                    metadata.hazard_type,
                    metadata.region_id,
                    metadata.version
                )
                self.models[model_key] = metadata
                model_count += 1
                
                logger.success(f"Registered model: {model_key}")
                
            except Exception as e:
                logger.error(f"Failed to load model from {model_dir.name}: {e}")
        
        if model_count == 0:
            logger.warning("No models found in registry - will use stub implementations")
        else:
            logger.success(f"Registered {model_count} models")
    
    def _get_model_key(self, hazard_type: str, region_id: str, version: str = None) -> str:
        """Generate standardized model key."""
        if version:
            return f"{hazard_type}_{region_id}_{version}"
        return f"{hazard_type}_{region_id}"
    
    async def get_model(
        self,
        hazard_type: str,
        region_id: str,
        version: Optional[str] = None
    ) -> Optional[Any]:
        """
        Get a loaded model instance.
        
        If version is not specified, returns the latest version for the hazard+region.
        Implements lazy loading - model is loaded only when first accessed.
        """
        # Find matching model
        if version:
            model_key = self._get_model_key(hazard_type, region_id, version)
            metadata = self.models.get(model_key)
        else:
            # Find latest version
            matching_keys = [
                k for k in self.models.keys()
                if k.startswith(f"{hazard_type}_{region_id}_")
            ]
            
            if not matching_keys:
                logger.warning(f"No model found for {hazard_type}/{region_id}")
                return None
            
            # Sort by version (assumes semantic versioning)
            model_key = sorted(matching_keys)[-1]
            metadata = self.models[model_key]
        
        if not metadata:
            return None
        
        # Lazy load model if not already loaded
        if metadata.loaded_model is None:
            if metadata.model_path and os.path.exists(metadata.model_path):
                try:
                    logger.info(f"Loading model: {model_key}")
                    metadata.loaded_model = joblib.load(metadata.model_path)
                    logger.success(f"Model loaded: {model_key}")
                except Exception as e:
                    logger.error(f"Failed to load model {model_key}: {e}")
                    return None
            else:
                logger.warning(f"Model file not found: {metadata.model_path}")
                return None
        
        metadata.last_used = datetime.utcnow()
        return metadata.loaded_model
    
    async def get_metadata(
        self,
        hazard_type: str,
        region_id: str,
        version: Optional[str] = None
    ) -> Optional[ModelMetadata]:
        """Get model metadata without loading the actual model."""
        if version:
            model_key = self._get_model_key(hazard_type, region_id, version)
            return self.models.get(model_key)
        else:
            matching_keys = [
                k for k in self.models.keys()
                if k.startswith(f"{hazard_type}_{region_id}_")
            ]
            if not matching_keys:
                return None
            model_key = sorted(matching_keys)[-1]
            return self.models[model_key]
    
    def record_prediction(
        self,
        hazard_type: str,
        region_id: str,
        latency_ms: float,
        version: Optional[str] = None
    ):
        """Record prediction metrics for monitoring."""
        metadata = None
        if version:
            model_key = self._get_model_key(hazard_type, region_id, version)
            metadata = self.models.get(model_key)
        else:
            matching_keys = [
                k for k in self.models.keys()
                if k.startswith(f"{hazard_type}_{region_id}_")
            ]
            if matching_keys:
                model_key = sorted(matching_keys)[-1]
                metadata = self.models[model_key]
        
        if metadata:
            metadata.prediction_count += 1
            metadata.total_latency += latency_ms
    
    def count_models(self) -> int:
        """Return total number of registered models."""
        return len(self.models)
    
    def list_models(self) -> List[Dict[str, Any]]:
        """List all registered models with their metadata."""
        return [
            {
                "name": m.name,
                "version": m.version,
                "hazard_type": m.hazard_type,
                "region_id": m.region_id,
                "trained_at": m.trained_at.isoformat(),
                "prediction_count": m.prediction_count,
                "avg_latency_ms": m.total_latency / m.prediction_count if m.prediction_count > 0 else 0,
                "performance_metrics": m.performance_metrics
            }
            for m in self.models.values()
        ]
    
    def get_supported_hazards(self) -> List[str]:
        """Get list of supported hazard types."""
        return list(set(m.hazard_type for m in self.models.values()))
    
    def get_supported_regions(self, hazard_type: str = None) -> List[str]:
        """Get list of supported regions, optionally filtered by hazard type."""
        if hazard_type:
            return list(set(
                m.region_id for m in self.models.values()
                if m.hazard_type == hazard_type
            ))
        return list(set(m.region_id for m in self.models.values()))
    
    async def cleanup(self):
        """Cleanup resources on shutdown."""
        logger.info("Cleaning up model registry...")
        # Unload models to free memory
        for metadata in self.models.values():
            metadata.loaded_model = None
        logger.success("Model registry cleanup complete")
