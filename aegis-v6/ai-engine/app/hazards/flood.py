"""
 AEGIS AI ENGINE — Flood Prediction Module
 Multi-layer ensemble flood prediction system
"""

from typing import Dict, List, Optional, Any, Tuple
import numpy as np
from datetime import datetime, timedelta
from loguru import logger

from app.schemas.predictions import (
    PredictionRequest,
    PredictionResponse,
    RiskLevel,
    HazardType,
    ContributingFactor,
    GeoPolygon
)
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.hazards.shap_explainer import explain_prediction

class FloodPredictor:
    """
    Advanced flood prediction module using multi-layer ensemble.
    
    Architecture:
    1. LSTM Time-Series Model - Temporal patterns
    2. XGBoost Spatial Model - Terrain and static features
    3. Hydrological Simulation - Physics-based runoff routing
    4. Ensemble Meta-Learner - Combines all predictions
    
    This is a STUB implementation that demonstrates the architecture.
    In production, each layer would be a trained model.
    """
    
    def __init__(
        self,
        model_registry: ModelRegistry,
        feature_store: FeatureStore
    ):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.FLOOD
        self._last_shap = None
        self._model_type_label = "supervised"
        self._label_strategy = "Trained on historical flood event records"
        logger.info("Flood prediction module initialized")
    
    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        """
        Generate flood prediction for a location.
        
        Process:
        1. Extract all features (static + dynamic + climate)
        2. Run ensemble prediction layers
        3. Calculate risk level and confidence
        4. Generate affected area polygon
        5. Identify contributing factors
        6. Return standardized prediction response
        """
        
        logger.info(
            f"Flood prediction request: "
            f"({request.latitude}, {request.longitude}) "
            f"region={request.region_id}"
        )
        
        start_time = datetime.utcnow()
        
        # Step 1: Extract features — pass any real observed values supplied by caller
        features = await self.feature_store.get_all_features(
            request.latitude,
            request.longitude,
            request.region_id,
            feature_overrides=request.feature_overrides,
        )
        
        # Validate features
        if not self.feature_store.validate_features(features):
            logger.warning("Feature validation failed - proceeding with caution")
        
        # Step 2: Attempt to load trained models
        # First try the exact region_id; fall back to the universal uk-default model
        model_metadata = await self.model_registry.get_metadata(
            self.hazard_type.value,
            request.region_id,
            request.model_version
        )
        if not model_metadata and request.region_id != 'uk-default':
            logger.debug(
                f"No flood model for region '{request.region_id}', "
                "falling back to uk-default"
            )
            model_metadata = await self.model_registry.get_metadata(
                self.hazard_type.value,
                'uk-default',
                request.model_version
            )

        if model_metadata:
            logger.info(f"Using model: {model_metadata.name} v{model_metadata.version}")

            # Load actual model — use the region that owns the model file,
            # which may differ from request.region_id when we fell back to uk-default
            model = await self.model_registry.get_model(
                self.hazard_type.value,
                model_metadata.region_id,
                model_metadata.version
            )
            
            if model:
                # Production path: use trained model
                probability, confidence = await self._predict_with_model(
                    model,
                    features,
                    model_metadata
                )
            else:
                # Fallback to stub
                logger.warning("Model file not found, using stub prediction")
                probability, confidence = self._stub_prediction(features)
        else:
            # No trained model available - use intelligent stub
            logger.warning(
                f"No trained flood model for {request.region_id}, "
                "using physics-based stub"
            )
            probability, confidence = self._stub_prediction(features)
        
        # Step 3: Classify risk level
        risk_level = self._classify_risk(probability)
        
        # Step 4: Calculate predicted peak time
        predicted_peak_time = self._estimate_peak_time(
            probability,
            features,
            request.forecast_horizon
        )
        
        # Step 5: Generate affected area polygon
        geo_polygon = self._generate_affected_polygon(
            request.latitude,
            request.longitude,
            probability,
            features
        )
        
        # Step 6: Identify contributing factors
        contributing_factors = self._identify_contributing_factors(
            features,
            probability
        )
        
        # Calculate execution time
        execution_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        # Record prediction metrics
        version = model_metadata.version if model_metadata else "stub-v1.0.0"
        self.model_registry.record_prediction(
            self.hazard_type.value,
            request.region_id,
            execution_time,
            version
        )
        
        logger.success(
            f"Flood prediction complete: "
            f"probability={probability:.2f}, risk={risk_level.value}, "
            f"confidence={confidence:.2f} ({execution_time:.0f}ms)"
        )
        
        # Build response following STRICT API CONTRACT
        return PredictionResponse(
            model_version=version,
            hazard_type=self.hazard_type,
            region_id=request.region_id,
            probability=probability,
            risk_level=risk_level,
            confidence=confidence,
            predicted_peak_time=predicted_peak_time.isoformat() if predicted_peak_time else None,
            geo_polygon=geo_polygon,
            contributing_factors=contributing_factors if request.include_contributing_factors else [],
            generated_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=6),
            data_sources=["river_gauge", "rainfall_radar", "dem", "historical_patterns"],
            warnings=[] if confidence > 0.7 else ["Low confidence - limited historical data"],
            model_type_label=self._model_type_label,
            shap_explanation=self._last_shap,
            label_strategy=self._label_strategy,
        )
    
    async def _predict_with_model(
        self,
        model: Any,
        features: Dict[str, float],
        metadata: Any
    ) -> Tuple[float, float]:
        """
        Use a trained model for prediction.
        Expects model to have a predict_proba method.
        """
        try:
            # Prepare feature vector in correct order.
            # The model expects 645 features including rolling means, lags,
            # interaction terms, and Fourier components.  We only have ~28
            # base features, so we use smart defaults for derived ones:
            # rolling_{stat}: use the base feature value (steady-state approx)
            # lag_Xh: use the base feature value
            # X_Y (product): multiply the two base values
            # DIV_Y (ratio): divide the two base values (guarded)
            # fourier_*/hour_of_day etc: compute from current time
            now = datetime.utcnow()
            time_defaults = {
                "hour_of_day": float(now.hour),
                "day_of_week": float(now.weekday()),
                "day_of_year": float(now.timetuple().tm_yday),
                "fourier_daily_sin": float(np.sin(2 * np.pi * now.hour / 24)),
                "fourier_daily_cos": float(np.cos(2 * np.pi * now.hour / 24)),
                "fourier_weekly_sin": float(np.sin(2 * np.pi * now.weekday() / 7)),
                "fourier_weekly_cos": float(np.cos(2 * np.pi * now.weekday() / 7)),
                "fourier_yearly_sin": float(np.sin(2 * np.pi * now.timetuple().tm_yday / 365)),
                "fourier_yearly_cos": float(np.cos(2 * np.pi * now.timetuple().tm_yday / 365)),
                # Hazard type one-hot
                "hazard_type_flood": 1.0,
            }

            def _resolve_feature(fname: str) -> float:
                # Direct match
                if fname in features:
                    return float(features[fname])
                # Time / Fourier
                if fname in time_defaults:
                    return time_defaults[fname]
                # Cumulative sums (use base feature value as approximation)
                if fname.endswith("_cumsum"):
                    base = fname[:-len("_cumsum")]
                    return float(features.get(base, 0.0))
                # Rate features (river_level_rate_1h, river_level_rate_3h)
                if "_rate_" in fname:
                    return 0.0  # Unknown rate → neutral
                # Saturation index
                if fname == "saturation_index":
                    return float(features.get("soil_moisture", 0.5))
                # Rolling mean/std/min/max — use base value
                for stat in ("_rolling_mean_", "_rolling_std_", "_rolling_min_", "_rolling_max_"):
                    if stat in fname:
                        base = fname.split(stat)[0]
                        val = float(features.get(base, 0.0))
                        # std of a constant signal is 0
                        if "_std_" in stat:
                            return 0.0
                        return val
                # Lag features
                if "_lag_" in fname:
                    base = fname.split("_lag_")[0]
                    return float(features.get(base, 0.0))
                # Interaction terms: A_X_B or A_DIV_B
                if "_X_" in fname:
                    parts = fname.split("_X_", 1)
                    return float(features.get(parts[0], 0.0)) * float(features.get(parts[1], 1.0))
                if "_DIV_" in fname:
                    parts = fname.split("_DIV_", 1)
                    denom = float(features.get(parts[1], 1.0))
                    return float(features.get(parts[0], 0.0)) / denom if denom != 0 else 0.0
                # Unknown feature — neutral zero
                return 0.0

            feature_vector = np.array([
                _resolve_feature(fname)
                for fname in metadata.feature_names
            ]).reshape(1, -1)
            
            # Get prediction
            if hasattr(model, 'predict_proba'):
                # Probabilistic classifier
                proba = model.predict_proba(feature_vector)[0, 1]
            elif hasattr(model, 'predict'):
                # Regressor or simple predictor
                proba = float(model.predict(feature_vector)[0])
            else:
                raise ValueError("Model has no predict method")
            
            # Clip to valid range
            probability = np.clip(proba, 0.0, 1.0)
            
            # Confidence from model metrics.
            # Use pr_auc (better for imbalanced data) or f1 — no artificial cap.
            pr_auc = metadata.performance_metrics.get('pr_auc', 0.0)
            f1 = metadata.performance_metrics.get('f1_score', 0.0)
            raw_conf = max(pr_auc, f1) if (pr_auc > 0 or f1 > 0) else 0.65
            confidence = round(min(0.99, max(0.40, raw_conf)), 3)
            
            # SHAP explainability
            shap_result = explain_prediction(model, feature_vector, list(metadata.feature_names))
            if shap_result:
                self._last_shap = shap_result
                if metadata.extra_metadata and 'model_type_label' in metadata.extra_metadata:
                    self._model_type_label = metadata.extra_metadata['model_type_label']
                if metadata.extra_metadata and 'label_strategy' in metadata.extra_metadata:
                    self._label_strategy = metadata.extra_metadata['label_strategy']
            
            return probability, confidence
            
        except Exception as e:
            logger.error(f"Model prediction failed: {e}")
            # Fallback to stub
            return self._stub_prediction(features)
    
    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        """
        Physics-based stub prediction when no trained model is available.
        Uses hydrological reasoning to estimate flood probability.
        """
        
        # Extract key hydrological features
        rainfall_24h = features.get('rainfall_24h', 0)
        rainfall_7d = features.get('rainfall_7d', 0)
        river_level = features.get('river_level', 0)
        soil_moisture = features.get('soil_moisture', 0.5)
        catchment_area = features.get('catchment_area', 100)
        elevation = features.get('elevation', 100)
        drainage_density = features.get('drainage_density', 2.0)
        
        # Simple runoff coefficient model
        # Higher rainfall + saturated soil + poor drainage = higher flood risk
        
        # Rainfall intensity factor (0-1)
        rainfall_factor = min(1.0, (rainfall_24h / 50.0) * 0.6 + (rainfall_7d / 200.0) * 0.4)
        
        # Saturation factor (0-1)
        saturation_factor = min(1.0, soil_moisture * 1.2)
        
        # River level factor (normalized estimate)
        # Assume normal levels are 1.0-2.0m, flood at 3.0m+
        river_factor = min(1.0, max(0.0, (river_level - 1.0) / 2.0))
        
        # Terrain factor (lower elevation = higher risk)
        terrain_factor = 1.0 - min(1.0, elevation / 200.0)
        
        # Drainage factor (poor drainage = higher risk)
        drainage_factor = max(0.0, 1.0 - (drainage_density / 4.0))
        
        # Combined probability (weighted ensemble)
        probability = (
            rainfall_factor * 0.35 +
            saturation_factor * 0.20 +
            river_factor * 0.30 +
            terrain_factor * 0.10 +
            drainage_factor * 0.05
        )
        
        # Clip to valid range
        probability = np.clip(probability, 0.0, 1.0)
        
        # Confidence is lower for stub predictions
        confidence = 0.65
        
        logger.debug(f"Stub prediction: prob={probability:.3f}, conf={confidence:.3f}")
        
        return float(probability), float(confidence)
    
    def _classify_risk(self, probability: float) -> RiskLevel:
        """Classify probability into risk levels."""
        if probability >= 0.75:
            return RiskLevel.CRITICAL
        elif probability >= 0.55:
            return RiskLevel.HIGH
        elif probability >= 0.30:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _estimate_peak_time(
        self,
        probability: float,
        features: Dict[str, float],
        forecast_horizon: int
    ) -> Optional[datetime]:
        """
        Estimate when flood will peak.
        Based on rainfall intensity and catchment response time.
        """
        if probability < 0.3:
            return None  # Not significant enough to predict peak
        
        # Simple time-to-peak estimation
        # Faster response for small catchments, intense rainfall
        catchment_area = features.get('catchment_area', 200)
        rainfall_intensity = features.get('rainfall_1h', 0)
        
        # Typical time to peak (hours) for different catchment sizes
        # Small (<100 km²): 2-6 hours
        # Medium (100-500 km²): 6-24 hours
        # Large (>500 km²): 24-72 hours
        
        if catchment_area < 100:
            base_hours = 3
        elif catchment_area < 500:
            base_hours = 12
        else:
            base_hours = 36
        
        # Adjust for rainfall intensity
        if rainfall_intensity > 10:  # Heavy rainfall
            base_hours *= 0.7
        
        # Add some physics-based variability
        hours_to_peak = base_hours * (0.8 + 0.4 * probability)
        
        peak_time = datetime.utcnow() + timedelta(hours=hours_to_peak)
        
        return peak_time
    
    def _generate_affected_polygon(
        self,
        latitude: float,
        longitude: float,
        probability: float,
        features: Dict[str, float]
    ) -> Optional[GeoPolygon]:
        """
        Generate GeoJSON polygon for affected area.
        In production, would use flood mapping models and DEM analysis.
        """
        
        # Estimate affected radius based on probability and terrain
        base_radius_km = 2.0
        radius_km = base_radius_km * (0.5 + probability * 1.5)
        
        # Convert km to degrees (rough approximation)
        # 1 degree latitude ≈ 111 km
        # Longitude varies by latitude
        lat_delta = radius_km / 111.0
        lng_delta = radius_km / (111.0 * np.cos(np.radians(latitude)))
        
        # Create a simple rectangular polygon
        # In production, would use actual flood extent modeling
        coordinates = [[
            [longitude - lng_delta, latitude + lat_delta],  # NW
            [longitude + lng_delta, latitude + lat_delta],  # NE
            [longitude + lng_delta, latitude - lat_delta],  # SE
            [longitude - lng_delta, latitude - lat_delta],  # SW
            [longitude - lng_delta, latitude + lat_delta],  # Close polygon
        ]]
        
        return GeoPolygon(
            type="Polygon",
            coordinates=coordinates
        )
    
    def _identify_contributing_factors(
        self,
        features: Dict[str, float],
        probability: float
    ) -> List[ContributingFactor]:
        """
        Identify and rank contributing factors using feature importance.
        In production, would use SHAP values from trained models.
        """
        
        # Calculate importance scores (stub - would use SHAP in production)
        candidates = [
            ("rainfall_24h", features.get('rainfall_24h', 0), "mm"),
            ("rainfall_7d", features.get('rainfall_7d', 0), "mm"),
            ("river_level", features.get('river_level', 0), "m"),
            ("soil_moisture", features.get('soil_moisture', 0), "fraction"),
            ("catchment_area", features.get('catchment_area', 0), "km²"),
            ("elevation", features.get('elevation', 0), "m"),
            ("drainage_density", features.get('drainage_density', 0), "km/km²"),
            ("impervious_surface_ratio", features.get('impervious_surface_ratio', 0), "fraction"),
        ]
        
        # Calculate normalized importance
        factors = []
        for name, value, unit in candidates:
            # Simple heuristic importance calculation
            if "rainfall" in name:
                importance = min(1.0, value / 50.0)
            elif name == "river_level":
                importance = min(1.0, max(0.0, (value - 1.0) / 2.0))
            elif name == "soil_moisture":
                importance = value
            elif name == "elevation":
                importance = 1.0 - min(1.0, value / 200.0)
            else:
                importance = 0.3
            
            # Scale by probability
            importance *= (0.5 + 0.5 * probability)
            
            if importance > 0.1:  # Only include significant factors
                factors.append(ContributingFactor(
                    factor=name,
                    value=round(value, 2),
                    importance=round(importance, 3),
                    unit=unit
                ))
        
        # Sort by importance and return top factors
        factors.sort(key=lambda f: f.importance, reverse=True)
        return factors[:8]  # Top 8 factors
