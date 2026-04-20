"""
Estimates chemical spill and air-quality exceedance risk based on wind
direction, proximity to known industrial sites, and current humidity.
Designed for short-notice incidents where plume modelling is not yet
available.

Serves the /predict endpoint for the environmental_hazard hazard type
and falls back to a heuristic score when the trained model file is absent.
"""

"""
 AEGIS AI ENGINE — Environmental Hazard Prediction Module
 Air quality degradation and hazmat release risk assessment using
 atmospheric stability, wind dispersion, and pollutant source proximity.
"""

from typing import Dict, List, Optional, Any, Tuple
import numpy as np
from datetime import datetime, timedelta
from loguru import logger

from app.schemas.predictions import (
    PredictionRequest, PredictionResponse, RiskLevel, HazardType,
    GeoPolygon, ContributingFactor
)
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.hazards.shap_explainer import explain_prediction

class EnvironmentalHazardPredictor:
    """
    Environmental hazard risk — air quality, chemical releases, pollution.
    Uses atmospheric dispersion proxies: wind speed (dilution vs transport),
    humidity (particulate trapping), temperature inversion risk (low wind +
    cold = pollutant concentration), and NDVI (vegetation buffer).
    """

    def __init__(self, model_registry: ModelRegistry, feature_store: FeatureStore):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.ENVIRONMENTAL
        self._last_shap = None
        self._model_type_label = None
        self._label_strategy = None
        logger.info("EnvironmentalHazard prediction module initialized")

    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        logger.info(f"EnvHazard prediction: ({request.latitude}, {request.longitude}) region={request.region_id}")
        start_time = datetime.utcnow()

        features = await self.feature_store.get_all_features(
            request.latitude, request.longitude, request.region_id
        )

        model_metadata = await self.model_registry.get_metadata(
            self.hazard_type.value, request.region_id, request.model_version
        )
        if not model_metadata and request.region_id != "uk-default":
            model_metadata = await self.model_registry.get_metadata(
                self.hazard_type.value, "uk-default", request.model_version
            )

        if model_metadata:
            model = await self.model_registry.get_model(
                self.hazard_type.value, model_metadata.region_id, model_metadata.version
            )
            probability, confidence = (
                await self._predict_with_model(model, features, model_metadata)
                if model else self._stub_prediction(features)
            )
        else:
            probability, confidence = self._stub_prediction(features)

        risk_level = self._classify_risk(probability)
        geo_polygon = self._generate_affected_polygon(request.latitude, request.longitude, probability)
        contributing_factors = self._identify_contributing_factors(features, probability)
        execution_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        version = model_metadata.version if model_metadata else "stub-v1.0.0"
        self.model_registry.record_prediction(self.hazard_type.value, request.region_id, execution_time, version)

        logger.success(f"EnvHazard prediction: prob={probability:.2f}, risk={risk_level.value}")
        return PredictionResponse(
            model_version=version,
            hazard_type=self.hazard_type,
            region_id=request.region_id,
            probability=probability,
            risk_level=risk_level,
            confidence=confidence,
            predicted_peak_time=None,
            geo_polygon=geo_polygon,
            contributing_factors=contributing_factors if request.include_contributing_factors else [],
            generated_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=12),
            data_sources=["air_quality_api", "weather_api", "ea_water_quality", "citizen_reports"],
            warnings=["Limit outdoor activity if air quality deteriorates"] if probability > 0.45 else [],
            model_type_label=self._model_type_label or ("rule_based" if not model_metadata else "weakly_supervised"),
            shap_explanation=self._last_shap,
            label_strategy=self._label_strategy,
        )

    async def _predict_with_model(self, model, features, metadata) -> Tuple[float, float]:
        try:
            fv = np.array([features.get(f, 0.0) for f in metadata.feature_names]).reshape(1, -1)
            prob = model.predict_proba(fv)[0, 1] if hasattr(model, "predict_proba") else float(model.predict(fv)[0])
            # Apply cost-optimal threshold from training metadata.
            # Rescale probability relative to threshold so risk banding stays
            # meaningful: [0, threshold] -> [0, 0.5], [threshold, 1] -> [0.5, 1].
            _thr = float((getattr(metadata, 'extra_metadata', None) or {}).get('optimal_threshold', 0.5))
            _p = float(np.clip(prob, 0.0, 1.0))
            if 0.0 < _thr < 1.0 and _thr != 0.5:
                _p = (_p / _thr * 0.5) if _p < _thr else (0.5 + (_p - _thr) / (1.0 - _thr) * 0.5)
            prob = float(np.clip(_p, 0.0, 1.0))
            self._last_shap = explain_prediction(model, fv, list(metadata.feature_names))
            self._model_type_label = getattr(metadata, 'model_type_label', None)
            self._label_strategy = getattr(metadata, 'label_strategy', None)
            return float(np.clip(prob, 0.0, 1.0)), metadata.performance_metrics.get("roc_auc", 0.73)
        except Exception as e:
            logger.error(f"Model error: {e}")
            return self._stub_prediction(features)

    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        wind_speed   = features.get("wind_speed", 5.0)
        humidity     = features.get("humidity", 60.0)
        temp         = features.get("temperature", 12.0)
        ndvi         = features.get("vegetation_index_ndvi", 0.4)
        et           = features.get("evapotranspiration", 1.5)

        # Low wind = poor dispersion (concentration risk)
        dispersion_lack = min(1.0, max(0.0, 1.0 - wind_speed / 8.0))
        # High humidity traps fine particles
        humidity_trap = min(0.3, max(0.0, (humidity - 70.0) / 30.0))
        # Temperature inversion: cold dense air traps pollution at surface
        inversion_risk = min(0.3, max(0.0, (5.0 - temp) / 10.0)) if temp < 5 else 0.0
        # Sparse vegetation = reduced natural filtering
        veg_deficit = max(0.0, 0.6 - ndvi)
        # Base risk from seasonal industrial patterns
        base = 0.10

        probability = np.clip(
            base + dispersion_lack * 0.40 + humidity_trap + inversion_risk + veg_deficit * 0.15,
            0.0, 1.0
        )
        return float(probability), 0.68

    def _classify_risk(self, probability: float) -> RiskLevel:
        if probability >= 0.70:   return RiskLevel.CRITICAL
        if probability >= 0.45:   return RiskLevel.HIGH
        if probability >= 0.20:   return RiskLevel.MEDIUM
        return RiskLevel.LOW

    def _generate_affected_polygon(self, lat: float, lng: float, prob: float) -> Optional[GeoPolygon]:
        radius_km = 2.0 + prob * 10.0
        d_lat = radius_km / 111.0
        d_lng = radius_km / (111.0 * np.cos(np.radians(lat)))
        return GeoPolygon(coordinates=[[
            [lng - d_lng, lat - d_lat], [lng + d_lng, lat - d_lat],
            [lng + d_lng, lat + d_lat], [lng - d_lng, lat + d_lat],
            [lng - d_lng, lat - d_lat],
        ]])

    def _identify_contributing_factors(self, features: Dict[str, float], prob: float) -> List[ContributingFactor]:
        return [
            ContributingFactor(factor="wind_speed",   value=round(features.get("wind_speed", 0), 1),  importance=0.40, unit="m/s"),
            ContributingFactor(factor="humidity",     value=round(features.get("humidity", 0), 1),    importance=0.25, unit="%"),
            ContributingFactor(factor="temperature",  value=round(features.get("temperature", 0), 1), importance=0.20, unit="°C"),
            ContributingFactor(factor="ndvi",         value=round(features.get("vegetation_index_ndvi", 0), 2), importance=0.15, unit="index"),
            ContributingFactor(factor="overall_risk", value=round(prob, 2),                            importance=1.0,  unit="probability"),
        ]
