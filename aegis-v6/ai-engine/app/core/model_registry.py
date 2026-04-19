"""
Disk-backed ML model registry: persists trained scikit-learn pipelines as
joblib files and metadata as JSON under ai-engine/model_registry/. On
startup loads all available models into an in-memory cache. Hazard
predictors call registry.load(hazard_type) and registry.save(model).
Supports model versioning (latest, previous, rollback).

- Initialised as a global singleton in ai-engine/main.py
- All hazard predictors (ai-engine/app/hazards/*.py) use this to load/save
- governance.py uses registry metadata to track model versions
- Model files stored in ai-engine/model_registry/ (mapped as Docker volume)

- ai-engine/app/core/governance.py  -- model approval and versioning workflow
"""

from typing import Dict, List, Optional, Any
from pathlib import Path
import joblib
import json
import shutil
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
        self.extra_metadata: Dict[str, Any] = {}
        self.loaded_model = None
        self.prediction_count = 0
        self.total_latency = 0.0
        self.last_used = None
        self.health_status = "healthy"
        self.drift_score = 0.0
        self.fallback_count = 0
        self.recommended_rollback_version: Optional[str] = None

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
                # Capture extra fields for transparency and governance
                _EXTRA_KEYS = (
                    'model_type_label', 'label_strategy', 'known_limitations',
                    'data_sources_detail', 'task_type', 'label_provenance',
                    'promotion_status', 'training_samples', 'temporal_range',
                    'data_sources', 'shap_feature_importance',
                    'health_status', 'drift_score', 'fallback_count',
                    'recommended_rollback_version', 'last_monitoring_snapshot',
                    'training_feature_means', 'training_feature_stds',
                    'class_balance', 'validation_confidence_stats',
                    'reference_shap_importance_ranking',
                    'baseline_prediction_distribution',
                    # Cost-optimal decision threshold and Platt calibration notes.
                    # Use optimal_threshold (not 0.5) when converting probability
                    # to a binary alert decision in inference code.
                    'optimal_threshold', 'calibration',
                )
                for key in _EXTRA_KEYS:
                    if key in metadata_dict:
                        metadata.extra_metadata[key] = metadata_dict[key]

                # Skip candidates/rejected unless they are the only version
                promotion = metadata_dict.get('promotion_status')
                if promotion == 'rejected':
                    # Still register but mark so promoted versions win selection
                    metadata.extra_metadata['_rejected'] = True
                
                # Register model
                model_key = self._get_model_key(
                    metadata.hazard_type,
                    metadata.region_id,
                    metadata.version
                )
                metadata.health_status = metadata.extra_metadata.get("health_status", "healthy")
                metadata.drift_score = float(metadata.extra_metadata.get("drift_score", 0.0) or 0.0)
                metadata.fallback_count = int(metadata.extra_metadata.get("fallback_count", 0) or 0)
                metadata.recommended_rollback_version = metadata.extra_metadata.get("recommended_rollback_version")
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

        If version is not specified, uses deterministic selection:
        manual promotion override > metadata promoted > latest non-rejected.
        Implements lazy loading - model is loaded only when first accessed.
        """
        # Find matching model
        if version:
            model_key = self._get_model_key(hazard_type, region_id, version)
            metadata = self.models.get(model_key)
        else:
            # Use deterministic current-model selection (respects promotions.json)
            model_key = self.get_current_model_key(hazard_type, region_id)
            if not model_key:
                logger.warning(f"No model found for {hazard_type}/{region_id}")
                return None
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
                    metadata.fallback_count += 1
                    metadata.extra_metadata["fallback_count"] = metadata.fallback_count
                    self._update_disk_metadata(model_key, {"fallback_count": metadata.fallback_count})
                    logger.error(f"Failed to load model {model_key}: {e}")
                    return None
            else:
                metadata.fallback_count += 1
                metadata.extra_metadata["fallback_count"] = metadata.fallback_count
                self._update_disk_metadata(model_key, {"fallback_count": metadata.fallback_count})
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
        """Get model metadata without loading the actual model.

        Uses the same deterministic selection as get_model() when version is None.
        """
        if version:
            model_key = self._get_model_key(hazard_type, region_id, version)
            return self.models.get(model_key)
        else:
            model_key = self.get_current_model_key(hazard_type, region_id)
            if not model_key:
                return None
            return self.models[model_key]
    
    def _best_key(self, keys: List[str]) -> str:
        """Pick the best model key: promoted > candidate > any, then latest."""
        promoted = [k for k in keys if not self.models[k].extra_metadata.get('_rejected')]
        pool = promoted if promoted else keys
        return sorted(pool)[-1]

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
                "performance_metrics": m.performance_metrics,
                "task_type": m.extra_metadata.get("task_type"),
                "promotion_status": m.extra_metadata.get("promotion_status"),
                "label_provenance": m.extra_metadata.get("label_provenance"),
                "health_status": m.health_status,
                "drift_score": m.drift_score,
                "fallback_count": m.fallback_count,
                "recommended_rollback_version": m.recommended_rollback_version,
            }
            for m in self.models.values()
        ]

    def recommend_rollback_target(self, hazard_type: str, region_id: str) -> Optional[str]:
        """Pick deterministic rollback target: most recent valid, non-current version."""
        current_key = self.get_current_model_key(hazard_type, region_id)
        model_type = f"{hazard_type}_{region_id}"
        candidates = sorted(
            [k for k in self.models if k.startswith(f"{model_type}_")],
            reverse=True,
        )
        for key in candidates:
            if key == current_key:
                continue
            meta = self.models[key]
            if meta.extra_metadata.get("_rejected"):
                continue
            if not (meta.model_path and os.path.exists(meta.model_path)):
                continue
            return meta.version
        return None

    def mark_model_health(
        self,
        hazard_type: str,
        region_id: str,
        version: str,
        health_status: str,
        drift_score: Optional[float] = None,
        fallback_count: Optional[int] = None,
        recommended_rollback_version: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Persist model health status in memory and metadata.json."""
        key = self._get_model_key(hazard_type, region_id, version)
        if key not in self.models:
            return {"status": "error", "error": f"Version {version} not found"}

        allowed = {"healthy", "watch", "degraded", "rollback_recommended"}
        if health_status not in allowed:
            return {"status": "error", "error": f"Invalid health_status: {health_status}"}

        meta = self.models[key]
        now = datetime.utcnow().isoformat()
        meta.health_status = health_status
        meta.extra_metadata["health_status"] = health_status
        meta.extra_metadata["last_monitoring_snapshot"] = now
        updates: Dict[str, Any] = {
            "health_status": health_status,
            "last_monitoring_snapshot": now,
        }

        if drift_score is not None:
            score = max(0.0, min(1.0, float(drift_score)))
            meta.drift_score = score
            meta.extra_metadata["drift_score"] = score
            updates["drift_score"] = score

        if fallback_count is not None:
            fcount = max(0, int(fallback_count))
            meta.fallback_count = fcount
            meta.extra_metadata["fallback_count"] = fcount
            updates["fallback_count"] = fcount

        if recommended_rollback_version is not None:
            meta.recommended_rollback_version = recommended_rollback_version
            meta.extra_metadata["recommended_rollback_version"] = recommended_rollback_version
            updates["recommended_rollback_version"] = recommended_rollback_version

        if reason:
            meta.extra_metadata["health_reason"] = reason
            updates["health_reason"] = reason

        self._update_disk_metadata(key, updates)
        return {
            "status": "success",
            "key": key,
            "health_status": health_status,
            "drift_score": meta.drift_score,
            "fallback_count": meta.fallback_count,
            "recommended_rollback_version": meta.recommended_rollback_version,
        }

    def get_model_health(self, hazard_type: str, region_id: str) -> Dict[str, Any]:
        """Return active model health summary for governance dashboards."""
        current_key = self.get_current_model_key(hazard_type, region_id)
        if not current_key:
            return {
                "hazard_type": hazard_type,
                "region_id": region_id,
                "status": "error",
                "error": "No active model",
            }

        current = self.models[current_key]
        recommended = current.recommended_rollback_version or self.recommend_rollback_target(hazard_type, region_id)
        health_status = current.health_status
        if health_status == "degraded" and recommended:
            health_status = "rollback_recommended"

        return {
            "hazard_type": hazard_type,
            "region_id": region_id,
            "current_version": current.version,
            "current_key": current_key,
            "health_status": health_status,
            "drift_score": round(float(current.drift_score or 0.0), 4),
            "fallback_count": int(current.fallback_count or 0),
            "recommended_rollback_version": recommended,
            "last_monitoring_snapshot": current.extra_metadata.get("last_monitoring_snapshot"),
        }
    
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
    
    # Promotion config persistence

    def _promotions_path(self) -> Path:
        return self.registry_path / "promotions.json"

    def _load_promotions(self) -> Dict[str, str]:
        """Load manual promotion overrides: {model_type: version}."""
        p = self._promotions_path()
        if p.exists():
            try:
                with open(p, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_promotions(self, promotions: Dict[str, str]) -> None:
        with open(self._promotions_path(), "w") as f:
            json.dump(promotions, f, indent=2)

    # Lifecycle methods

    def get_current_model_key(
        self, hazard_type: str, region_id: str
    ) -> Optional[str]:
        """Deterministic active-model selection.

        Priority:
        1. Manual promotion override (promotions.json)
        2. Metadata promotion_status == 'promoted'
        3. Latest non-rejected version
        """
        model_type = f"{hazard_type}_{region_id}"
        promotions = self._load_promotions()

        # 1. Manual override
        if model_type in promotions:
            override_ver = promotions[model_type]
            key = self._get_model_key(hazard_type, region_id, override_ver)
            if key in self.models:
                return key
            logger.warning(
                f"Promotion override for {model_type} points to missing version {override_ver}"
            )

        # 2. Find all versions for this hazard+region
        matching = [
            k for k in self.models
            if k.startswith(f"{model_type}_")
        ]
        if not matching:
            return None

        # 3. Prefer metadata-promoted, then best non-rejected
        promoted = [
            k for k in matching
            if self.models[k].extra_metadata.get("promotion_status") == "promoted"
            and not self.models[k].extra_metadata.get("_rejected")
        ]
        if promoted:
            return sorted(promoted)[-1]

        return self._best_key(matching)

    def list_versions(
        self, hazard_type: str, region_id: str
    ) -> List[Dict[str, Any]]:
        """List all versions for a hazard+region, newest first."""
        model_type = f"{hazard_type}_{region_id}"
        matching = [
            k for k in self.models
            if k.startswith(f"{model_type}_")
        ]
        current_key = self.get_current_model_key(hazard_type, region_id)

        versions = []
        for key in sorted(matching, reverse=True):
            m = self.models[key]
            versions.append({
                "version": m.version,
                "key": key,
                "trained_at": m.trained_at.isoformat(),
                "promotion_status": m.extra_metadata.get("promotion_status", "none"),
                "is_current": key == current_key,
                "performance_metrics": m.performance_metrics,
                "prediction_count": m.prediction_count,
                "has_model_file": bool(m.model_path and os.path.exists(m.model_path)),
            })
        return versions

    def promote_model(
        self, hazard_type: str, region_id: str, version: str
    ) -> Dict[str, Any]:
        """Manually promote a specific version as the active model.

        Persists override in promotions.json and updates metadata on disk.
        """
        model_type = f"{hazard_type}_{region_id}"
        key = self._get_model_key(hazard_type, region_id, version)

        if key not in self.models:
            return {"status": "error", "error": f"Version {version} not found"}

        meta = self.models[key]

        # Validate model integrity first
        integrity = self.validate_model_integrity(hazard_type, region_id, version)
        if not integrity["valid"]:
            return {
                "status": "error",
                "error": f"Model fails integrity check: {integrity['issues']}",
            }

        # Persist promotion override
        promotions = self._load_promotions()
        previous = promotions.get(model_type)
        promotions[model_type] = version
        self._save_promotions(promotions)

        # Update in-memory metadata
        meta.extra_metadata["promotion_status"] = "promoted"
        meta.extra_metadata.pop("_rejected", None)

        # Update metadata.json on disk
        self._update_disk_metadata(key, {"promotion_status": "promoted"})

        logger.success(f"Promoted {key} as active model (previous: {previous})")
        return {
            "status": "success",
            "promoted": key,
            "previous_version": previous,
        }

    def demote_model(
        self, hazard_type: str, region_id: str
    ) -> Dict[str, Any]:
        """Remove manual promotion override, revert to automatic selection."""
        model_type = f"{hazard_type}_{region_id}"
        promotions = self._load_promotions()

        if model_type not in promotions:
            return {"status": "noop", "message": "No manual override to remove"}

        removed_version = promotions.pop(model_type)
        self._save_promotions(promotions)

        # Determine new active model
        new_current = self.get_current_model_key(hazard_type, region_id)
        logger.info(
            f"Demoted manual override {removed_version} for {model_type}. "
            f"New active: {new_current}"
        )
        return {
            "status": "success",
            "removed_override": removed_version,
            "new_current": new_current,
        }

    def validate_model_integrity(
        self, hazard_type: str, region_id: str, version: str
    ) -> Dict[str, Any]:
        """Check model.pkl exists, metadata.json has required fields, model loads."""
        key = self._get_model_key(hazard_type, region_id, version)
        issues: List[str] = []

        meta = self.models.get(key)
        if not meta:
            return {"valid": False, "issues": ["Version not registered"]}

        # Check model file exists
        if not meta.model_path or not os.path.exists(meta.model_path):
            issues.append("model.pkl missing or path invalid")

        # Check metadata.json on disk
        dir_name = f"{hazard_type}_{region_id}_{version}"
        metadata_path = self.registry_path / dir_name / "metadata.json"
        if not metadata_path.exists():
            # Try finding by scanning dirs
            found = False
            for d in self.registry_path.iterdir():
                if d.is_dir() and (d / "metadata.json").exists():
                    try:
                        with open(d / "metadata.json") as f:
                            md = json.load(f)
                        if (md.get("hazard_type") == hazard_type
                                and md.get("region_id") == region_id
                                and md.get("version") == version):
                            metadata_path = d / "metadata.json"
                            found = True
                            break
                    except Exception:
                        continue
            if not found:
                issues.append("metadata.json not found on disk")

        # Required metadata fields
        required_fields = ["hazard_type", "region_id", "version", "trained_at"]
        if metadata_path.exists():
            try:
                with open(metadata_path) as f:
                    disk_meta = json.load(f)
                for field in required_fields:
                    if field not in disk_meta:
                        issues.append(f"Missing required field: {field}")
            except json.JSONDecodeError:
                issues.append("metadata.json is not valid JSON")

        # Try loading model if file exists and no issues so far
        if not issues and meta.model_path and os.path.exists(meta.model_path):
            try:
                joblib.load(meta.model_path)
            except Exception as e:
                issues.append(f"model.pkl fails to load: {e}")

        return {"valid": len(issues) == 0, "issues": issues}

    def cleanup_old_versions(
        self, hazard_type: str, region_id: str, keep: int = 3, dry_run: bool = False
    ) -> Dict[str, Any]:
        """Remove old versions, keeping the N newest + any promoted version.

        Returns list of removed and kept versions.
        """
        model_type = f"{hazard_type}_{region_id}"
        matching = sorted(
            [k for k in self.models if k.startswith(f"{model_type}_")],
            reverse=True,
        )

        if len(matching) <= keep:
            return {
                "status": "noop",
                "message": f"Only {len(matching)} versions exist (keep={keep})",
                "kept": matching,
                "removed": [],
            }

        current_key = self.get_current_model_key(hazard_type, region_id)
        promotions = self._load_promotions()
        promoted_ver = promotions.get(model_type)

        # Always keep: newest `keep` + current + promoted
        keep_set = set(matching[:keep])
        if current_key:
            keep_set.add(current_key)
        if promoted_ver:
            pkey = self._get_model_key(hazard_type, region_id, promoted_ver)
            if pkey in self.models:
                keep_set.add(pkey)

        to_remove = [k for k in matching if k not in keep_set]
        removed = []

        for key in to_remove:
            meta = self.models[key]
            if dry_run:
                removed.append({"key": key, "action": "would_remove"})
                continue

            # Delete directory on disk
            self._delete_model_dir(meta)

            # Unregister
            del self.models[key]
            removed.append({"key": key, "action": "removed"})
            logger.info(f"Cleaned up old model: {key}")

        return {
            "status": "success",
            "kept": list(keep_set),
            "removed": removed,
            "dry_run": dry_run,
        }

    def cleanup_all_hazards(
        self, keep: int = 3, dry_run: bool = False
    ) -> Dict[str, Any]:
        """Run cleanup for every hazard+region combination."""
        combos = set()
        for m in self.models.values():
            combos.add((m.hazard_type, m.region_id))

        results = {}
        for ht, rid in combos:
            r = self.cleanup_old_versions(ht, rid, keep=keep, dry_run=dry_run)
            results[f"{ht}_{rid}"] = r
        return results

    # Helpers

    def _update_disk_metadata(self, model_key: str, updates: Dict[str, Any]) -> None:
        """Update metadata.json on disk for a registered model."""
        meta = self.models.get(model_key)
        if not meta or not meta.model_path:
            return
        model_dir = Path(meta.model_path).parent
        metadata_path = model_dir / "metadata.json"
        if not metadata_path.exists():
            return
        try:
            with open(metadata_path, "r") as f:
                data = json.load(f)
            data.update(updates)
            with open(metadata_path, "w") as f:
                json.dump(data, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Failed to update metadata on disk for {model_key}: {e}")

    def _delete_model_dir(self, meta: ModelMetadata) -> None:
        """Delete the model directory from disk."""
        if not meta.model_path:
            return
        model_dir = Path(meta.model_path).parent
        if model_dir.exists() and model_dir.parent == self.registry_path:
            try:
                shutil.rmtree(model_dir)
                logger.info(f"Deleted model directory: {model_dir.name}")
            except Exception as e:
                logger.error(f"Failed to delete {model_dir}: {e}")

    async def cleanup(self):
        """Cleanup resources on shutdown."""
        logger.info("Cleaning up model registry...")
        # Unload models to free memory
        for metadata in self.models.values():
            metadata.loaded_model = None
        logger.success("Model registry cleanup complete")
