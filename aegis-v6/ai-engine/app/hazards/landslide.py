"""
 AEGIS AI ENGINE — Landslide Prediction Module
 Slope instability assessment using antecedent rainfall, soil saturation,
 elevation gradient, and vegetation coverage.
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

class LandslidePredictor:
    """
    Landslide / debris-flow prediction.
    Uses antecedent rainfall (24h + 7d), soil moisture, slope gradient,
    and soil type permeability as primary drivers.
    """

    def __init__(self, model_registry: ModelRegistry, feature_store: FeatureStore):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.LANDSLIDE
        self._last_shap = None
        self._model_type_label = None
        self._label_strategy = None
        logger.info("Landslide prediction module initialized")

    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        logger.info(f"Landslide prediction: ({request.latitude}, {request.longitude}) region={request.region_id}")
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

        logger.success(f"Landslide prediction: prob={probability:.2f}, risk={risk_level.value}")
        return PredictionResponse(
            model_version=version,
            hazard_type=self.hazard_type,
            region_id=request.region_id,
            probability=probability,
            risk_level=risk_level,
            confidence=confidence,
            predicted_peak_time=(datetime.utcnow() + timedelta(hours=3)).isoformat() if probability > 0.45 else None,
            geo_polygon=geo_polygon,
            contributing_factors=contributing_factors if request.include_contributing_factors else [],
            generated_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=24),
            data_sources=["soil_moisture", "rainfall_records", "dem_elevation", "geology"],
            warnings=["Avoid hill roads and steep slopes during active rain"] if probability > 0.45 else [],
            model_type_label=self._model_type_label or ("rule_based" if not model_metadata else "experimental"),
            shap_explanation=self._last_shap,
            label_strategy=self._label_strategy,
        )

    async def _predict_with_model(self, model, features, metadata) -> Tuple[float, float]:
        try:
            fv = np.array([features.get(f, 0.0) for f in metadata.feature_names]).reshape(1, -1)
            prob = model.predict_proba(fv)[0, 1] if hasattr(model, "predict_proba") else float(model.predict(fv)[0])
            self._last_shap = explain_prediction(model, fv, list(metadata.feature_names))
            self._model_type_label = getattr(metadata, 'model_type_label', None)
            self._label_strategy = getattr(metadata, 'label_strategy', None)
            return float(np.clip(prob, 0.0, 1.0)), metadata.performance_metrics.get("roc_auc", 0.75)
        except Exception as e:
            logger.error(f"Model error: {e}")
            return self._stub_prediction(features)

    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        rainfall_24h   = features.get("rainfall_24h", 5.0)
        rainfall_7d    = features.get("rainfall_7d", 20.0)
        soil_moisture  = features.get("soil_moisture", 0.5)
        basin_slope    = features.get("basin_slope", 10.0)       # degrees
        permeability   = features.get("permeability_index", 0.5) # 0=impermeable,1=permeable
        vegetation     = features.get("vegetation_index_ndvi", 0.4)

        # Antecedent rainfall saturation index
        rain_factor = min(1.0, (rainfall_24h / 50.0) * 0.6 + (rainfall_7d / 150.0) * 0.4)
        # Slope steepness (>30° very high risk)
        slope_factor = min(1.0, max(0.0, (basin_slope - 5.0) / 35.0))
        # Soil saturation
        moisture_factor = min(1.0, soil_moisture / 0.8)
        # Low permeability traps water
        impermeability_factor = 1.0 - permeability
        # Sparse vegetation = less root cohesion
        veg_factor = max(0.0, 1.0 - vegetation)

        probability = np.clip(
            rain_factor * 0.35 + slope_factor * 0.25 + moisture_factor * 0.20 +
            impermeability_factor * 0.10 + veg_factor * 0.10,
            0.0, 1.0
        )
        return float(probability), 0.68

    def _classify_risk(self, probability: float) -> RiskLevel:
        if probability >= 0.68:   return RiskLevel.CRITICAL
        if probability >= 0.45:   return RiskLevel.HIGH
        if probability >= 0.20:   return RiskLevel.MEDIUM
        return RiskLevel.LOW

    def _generate_affected_polygon(self, lat: float, lng: float, prob: float) -> Optional[GeoPolygon]:
        radius_km = 1.0 + prob * 5.0
        d_lat = radius_km / 111.0
        d_lng = radius_km / (111.0 * np.cos(np.radians(lat)))
        return GeoPolygon(coordinates=[[
            [lng - d_lng, lat - d_lat], [lng + d_lng, lat - d_lat],
            [lng + d_lng, lat + d_lat], [lng - d_lng, lat + d_lat],
            [lng - d_lng, lat - d_lat],
        ]])

    def _identify_contributing_factors(self, features: Dict[str, float], prob: float) -> List[ContributingFactor]:
        return [
            ContributingFactor(factor="rainfall_24h",  value=round(features.get("rainfall_24h", 0), 1),  importance=0.35, unit="mm"),
            ContributingFactor(factor="soil_moisture",  value=round(features.get("soil_moisture", 0), 2), importance=0.20, unit="fraction"),
            ContributingFactor(factor="basin_slope",    value=round(features.get("basin_slope", 0), 1),   importance=0.25, unit="degrees"),
            ContributingFactor(factor="overall_risk",   value=round(prob, 2),                              importance=1.0,  unit="probability"),
        ]
