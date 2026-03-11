"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Severe Storm Prediction Module
 Physics-based rule layer using wind speed, pressure drop, humidity,
 and precipitation intensity as primary indicators.
═══════════════════════════════════════════════════════════════════════════════
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


class SevereStormPredictor:
    """
    Severe storm prediction using wind thresholds, pressure gradients,
    and atmospheric instability indices.
    Falls back to a physics-based stub when no trained model is available.
    """

    def __init__(self, model_registry: ModelRegistry, feature_store: FeatureStore):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.SEVERE_STORM
        logger.info("SevereStorm prediction module initialized")

    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        logger.info(f"SevereStorm prediction: ({request.latitude}, {request.longitude}) region={request.region_id}")
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

        logger.success(f"SevereStorm prediction: prob={probability:.2f}, risk={risk_level.value}")
        return PredictionResponse(
            model_version=version,
            hazard_type=self.hazard_type,
            region_id=request.region_id,
            probability=probability,
            risk_level=risk_level,
            confidence=confidence,
            predicted_peak_time=(datetime.utcnow() + timedelta(hours=6)).isoformat() if probability > 0.4 else None,
            geo_polygon=geo_polygon,
            contributing_factors=contributing_factors if request.include_contributing_factors else [],
            generated_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=12),
            data_sources=["weather_api", "met_office", "radar", "citizen_reports"],
            warnings=["Storm windows can change rapidly — re-check every 30 minutes"] if probability > 0.55 else [],
        )

    async def _predict_with_model(self, model, features, metadata) -> Tuple[float, float]:
        try:
            fv = np.array([features.get(f, 0.0) for f in metadata.feature_names]).reshape(1, -1)
            prob = model.predict_proba(fv)[0, 1] if hasattr(model, "predict_proba") else float(model.predict(fv)[0])
            return float(np.clip(prob, 0.0, 1.0)), metadata.performance_metrics.get("roc_auc", 0.78)
        except Exception as e:
            logger.error(f"Model error: {e}")
            return self._stub_prediction(features)

    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        wind_speed   = features.get("wind_speed", 5.0)          # m/s
        rainfall_1h  = features.get("rainfall_1h", 0.0)          # mm
        humidity     = features.get("humidity", 60.0)            # %
        temp         = features.get("temperature", 12.0)         # °C
        seasonal     = features.get("seasonal_anomaly", 0.0)

        # Wind severity (Beaufort 8+ = 17m/s severe)
        wind_factor = min(1.0, max(0.0, (wind_speed - 10.0) / 25.0))
        # Intense rainfall
        rain_factor = min(1.0, rainfall_1h / 30.0)
        # High humidity + warm = convective instability
        instability = min(1.0, max(0.0, (humidity - 60.0) / 40.0) * max(0.0, (temp - 10.0) / 15.0))
        # Seasonal uplift (winter storms, summer convective)
        season_factor = min(0.2, abs(seasonal) * 0.1)

        probability = np.clip(
            wind_factor * 0.45 + rain_factor * 0.30 + instability * 0.20 + season_factor,
            0.0, 1.0
        )
        return float(probability), 0.72

    def _classify_risk(self, probability: float) -> RiskLevel:
        if probability >= 0.72:   return RiskLevel.CRITICAL
        if probability >= 0.50:   return RiskLevel.HIGH
        if probability >= 0.25:   return RiskLevel.MEDIUM
        return RiskLevel.LOW

    def _generate_affected_polygon(self, lat: float, lng: float, prob: float) -> Optional[GeoPolygon]:
        radius_km = 5.0 + prob * 20.0
        d_lat = radius_km / 111.0
        d_lng = radius_km / (111.0 * np.cos(np.radians(lat)))
        return GeoPolygon(coordinates=[[[
            [lng - d_lng, lat - d_lat], [lng + d_lng, lat - d_lat],
            [lng + d_lng, lat + d_lat], [lng - d_lng, lat + d_lat],
            [lng - d_lng, lat - d_lat],
        ]]])

    def _identify_contributing_factors(self, features: Dict[str, float], prob: float) -> List[ContributingFactor]:
        wind = features.get("wind_speed", 5.0)
        rain = features.get("rainfall_1h", 0.0)
        humidity = features.get("humidity", 60.0)
        return [
            ContributingFactor(factor="wind_speed",    value=round(wind, 1),     importance=0.45, unit="m/s"),
            ContributingFactor(factor="rainfall_1h",   value=round(rain, 1),     importance=0.30, unit="mm"),
            ContributingFactor(factor="humidity",      value=round(humidity, 1), importance=0.20, unit="%"),
            ContributingFactor(factor="overall_risk",  value=round(prob, 2),     importance=1.0,  unit="probability"),
        ]
