"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Water Supply Disruption Prediction Module
 Rule-based risk assessment using drought severity, infrastructure age,
 contamination indicators, and seasonal demand patterns.
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


class WaterSupplyPredictor:
    """
    Water supply disruption risk.
    Primary drivers: drought index (reservoir depletion), burst pipe risk
    from freeze-thaw cycles, contamination from flooding events, and
    demand surge during heatwaves.
    """

    def __init__(self, model_registry: ModelRegistry, feature_store: FeatureStore):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.WATER_SUPPLY
        logger.info("WaterSupply prediction module initialized")

    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        logger.info(f"WaterSupply prediction: ({request.latitude}, {request.longitude}) region={request.region_id}")
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

        logger.success(f"WaterSupply prediction: prob={probability:.2f}, risk={risk_level.value}")
        return PredictionResponse(
            model_version=version,
            hazard_type=self.hazard_type,
            region_id=request.region_id,
            probability=probability,
            risk_level=risk_level,
            confidence=confidence,
            predicted_peak_time=(datetime.utcnow() + timedelta(hours=12)).isoformat() if probability > 0.4 else None,
            geo_polygon=geo_polygon,
            contributing_factors=contributing_factors if request.include_contributing_factors else [],
            generated_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=24),
            data_sources=["drought_index", "weather_api", "utility_status", "citizen_reports"],
            warnings=["Store drinking water as precaution"] if probability > 0.50 else [],
        )

    async def _predict_with_model(self, model, features, metadata) -> Tuple[float, float]:
        try:
            fv = np.array([features.get(f, 0.0) for f in metadata.feature_names]).reshape(1, -1)
            prob = model.predict_proba(fv)[0, 1] if hasattr(model, "predict_proba") else float(model.predict(fv)[0])
            return float(np.clip(prob, 0.0, 1.0)), metadata.performance_metrics.get("roc_auc", 0.74)
        except Exception as e:
            logger.error(f"Model error: {e}")
            return self._stub_prediction(features)

    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        rainfall_30d   = features.get("rainfall_30d", 80.0)
        temp           = features.get("temperature", 10.0)
        soil_moisture  = features.get("soil_moisture", 0.5)
        river_level    = features.get("river_level", 1.0)
        long_anom      = features.get("long_term_rainfall_anomaly", 0.0)

        # Reservoir depletion proxy: low rainfall + low river
        drought_proxy = max(0.0, 1.0 - (rainfall_30d / 100.0)) * 0.5 + max(0.0, 1.0 - river_level) * 0.5
        # Freeze-thaw pipe burst risk (<0°C)
        freeze_factor = min(0.3, max(0.0, -temp / 10.0))
        # Flood contamination: very high river levels
        contamination = min(0.3, max(0.0, (river_level - 2.5) / 2.0))
        # Heatwave demand surge (>28°C)
        demand_surge = min(0.2, max(0.0, (temp - 28.0) / 10.0))
        # Long-term deficit
        deficit = max(0.0, -long_anom * 0.1)

        probability = np.clip(drought_proxy * 0.40 + freeze_factor + contamination + demand_surge + deficit, 0.0, 1.0)
        return float(probability), 0.72

    def _classify_risk(self, probability: float) -> RiskLevel:
        if probability >= 0.72:   return RiskLevel.CRITICAL
        if probability >= 0.50:   return RiskLevel.HIGH
        if probability >= 0.25:   return RiskLevel.MEDIUM
        return RiskLevel.LOW

    def _generate_affected_polygon(self, lat: float, lng: float, prob: float) -> Optional[GeoPolygon]:
        radius_km = 3.0 + prob * 12.0
        d_lat = radius_km / 111.0
        d_lng = radius_km / (111.0 * np.cos(np.radians(lat)))
        return GeoPolygon(coordinates=[[[
            [lng - d_lng, lat - d_lat], [lng + d_lng, lat - d_lat],
            [lng + d_lng, lat + d_lat], [lng - d_lng, lat + d_lat],
            [lng - d_lng, lat - d_lat],
        ]]])

    def _identify_contributing_factors(self, features: Dict[str, float], prob: float) -> List[ContributingFactor]:
        return [
            ContributingFactor(factor="rainfall_30d",  value=round(features.get("rainfall_30d", 0), 1),  importance=0.40, unit="mm"),
            ContributingFactor(factor="river_level",   value=round(features.get("river_level", 0), 2),   importance=0.25, unit="m"),
            ContributingFactor(factor="temperature",   value=round(features.get("temperature", 0), 1),   importance=0.20, unit="°C"),
            ContributingFactor(factor="overall_risk",  value=round(prob, 2),                              importance=1.0,  unit="probability"),
        ]
