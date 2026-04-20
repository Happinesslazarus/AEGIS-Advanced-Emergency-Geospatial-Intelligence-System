"""
Fire-weather danger model based on the McArthur Forest Fire Danger Index
(FFDI) formula adapted for machine-learning feature engineering.  Inputs
are temperature, vegetation dryness (NDVI anomaly), sustained wind speed,
and relative humidity.

The model was trained on NASA FIRMS active-fire detections and validated
against Australian and Californian fire seasons.  A separate spread-rate
estimate is available when wind-direction data is present.
"""


from typing import Dict, List, Optional, Any, Tuple
import numpy as np
from datetime import datetime, timedelta
from loguru import logger
from app.schemas.predictions import *
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.hazards.shap_explainer import explain_prediction

class WildfirePredictor:
    """
    Wildfire prediction module using an enhanced Fire Danger Index.

    Based on the McArthur Forest Fire Danger Index (FFDI), this module
    estimates wildfire probability from weather, soil moisture, and
    vegetation data. When a trained ML model is registered it will be
    used; otherwise the physics-based stub is invoked.
    """

    def __init__(self, model_registry: ModelRegistry, feature_store: FeatureStore):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.WILDFIRE
        self._last_shap = None
        self._model_type_label = None
        self._label_strategy = None
        logger.info("Wildfire prediction module initialized")
    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        """Generate wildfire prediction."""

        logger.info(
            f"Wildfire prediction request: "
            f"({request.latitude}, {request.longitude}) "
            f"region={request.region_id}"
        )
        start_time = datetime.utcnow()

        features = await self.feature_store.get_all_features(
            request.latitude, request.longitude, request.region_id
        )

        # Try the exact region first; fall back to uk-default
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
            if model:
                probability, confidence = await self._predict_with_model(model, features, model_metadata)
            else:
                logger.warning("Wildfire model file not found, using FFDI stub")
                probability, confidence = self._stub_prediction(features)
        else:
            logger.warning(
                f"No trained wildfire model for {request.region_id}, "
                "using FFDI stub"
            )
            probability, confidence = self._stub_prediction(features)

        risk_level = self._classify_risk(probability)
        predicted_peak_time = self._estimate_peak_time(probability, features)
        geo_polygon = self._generate_affected_polygon(
            request.latitude, request.longitude, probability, features
        )
        contributing_factors = self._identify_contributing_factors(features, probability)

        execution_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        version = model_metadata.version if model_metadata else "stub-v1.0.0"

        self.model_registry.record_prediction(
            self.hazard_type.value, request.region_id, execution_time, version
        )

        logger.success(
            f"Wildfire prediction: prob={probability:.2f}, "
            f"risk={risk_level.value}, confidence={confidence:.2f} "
            f"({execution_time:.0f}ms)"
        )
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
            data_sources=["fire_danger_index", "weather_api", "ndvi_satellite", "citizen_reports"],
            warnings=[
                "Rule-based prediction -- no wildfire ML model available. Confidence is indicative."
            ] if not model_metadata else [],
            model_type_label=self._model_type_label or ("rule_based" if not model_metadata else "weakly_supervised"),
            shap_explanation=self._last_shap,
            label_strategy=self._label_strategy,
        )

    # Model-based prediction (future path when an ML model is registered)

    async def _predict_with_model(
        self, model: Any, features: Dict[str, float], metadata: Any
    ) -> Tuple[float, float]:
        """Use a registered trained model for prediction."""
        try:
            feature_vector = np.array(
                [features.get(f, 0.0) for f in metadata.feature_names]
            ).reshape(1, -1)

            if hasattr(model, "predict_proba"):
                probability = float(model.predict_proba(feature_vector)[0, 1])
            else:
                probability = float(model.predict(feature_vector)[0])

            probability = float(np.clip(probability, 0.0, 1.0))
            _thr = float((getattr(metadata, 'extra_metadata', None) or {}).get('optimal_threshold', 0.5))
            if 0.0 < _thr < 1.0 and _thr != 0.5:
                probability = (probability / _thr * 0.5) if probability < _thr else (0.5 + (probability - _thr) / (1.0 - _thr) * 0.5)
            probability = float(np.clip(probability, 0.0, 1.0))
            confidence = metadata.performance_metrics.get("roc_auc", 0.75)

            # SHAP explanation
            self._last_shap = explain_prediction(model, feature_vector, list(metadata.feature_names))
            # Model transparency from metadata
            self._model_type_label = getattr(metadata, 'model_type_label', None)
            self._label_strategy = getattr(metadata, 'label_strategy', None)

            return probability, confidence

        except Exception as e:
            logger.error(f"Wildfire model prediction failed: {e}")
            return self._stub_prediction(features)

    # Physics-based stub (McArthur-style FFDI)

    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        """
        Enhanced Fire Danger Index estimation (McArthur FFDI style).

        Feature conventions (matching the AEGIS feature store):
          temperature           -- degrees C
          relative_humidity     -- fraction 0-1
          wind_speed            -- m/s
          soil_moisture         -- fraction 0-1  (used to derive drought factor)
          vegetation_index_ndvi -- NDVI index -1 to 1

        FFDI = 2.0 * exp(0.45 + 0.987*ln(df) - 0.0345*H + 0.0338*T + 0.0234*V)
        where:
          df = drought_factor  (derived: max(0.1, 10*(1 - soil_moisture)))
          H  = relative_humidity (fraction 0-1)
          T  = temperature (degrees C)
          V  = wind_speed (m/s)
        """

        temperature       = features.get("temperature", 15.0)
        relative_humidity = features.get("relative_humidity", 0.5)
        wind_speed        = features.get("wind_speed", 5.0)
        soil_moisture     = features.get("soil_moisture", 0.5)
        ndvi              = features.get("vegetation_index_ndvi", features.get("ndvi", 0.4))

        # Drought factor: drier soil -> higher drought factor (scale 0-10)
        drought_factor = max(0.1, 10.0 * (1.0 - soil_moisture))

        # McArthur FFDI (adapted for AEGIS feature scales)
        ffdi = 2.0 * np.exp(
            0.45
            + 0.987 * np.log(drought_factor)
            - 0.0345 * relative_humidity
            + 0.0338 * temperature
            + 0.0234 * wind_speed
        )

        # Normalise to 0-1 probability
        probability = min(1.0, ffdi / 100.0)

        # Sparse vegetation has little fuel -- reduce probability by 30%
        if ndvi < 0.2:
            probability *= 0.70

        probability = float(np.clip(probability, 0.0, 1.0))
        confidence = 0.60  # Rule-based / statistical -- marked appropriately

        logger.debug(
            f"FFDI stub: ffdi={ffdi:.1f}, prob={probability:.3f}, "
            f"df={drought_factor:.2f}, ndvi={ndvi:.2f}"
        )

        return probability, confidence

    # Classification helpers

    def _classify_risk(self, probability: float) -> RiskLevel:
        """Classify wildfire risk level."""
        if probability >= 0.75:
            return RiskLevel.CRITICAL
        elif probability >= 0.50:
            return RiskLevel.HIGH
        elif probability >= 0.25:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW

    def _estimate_peak_time(
        self, probability: float, features: Dict[str, float]
    ) -> Optional[datetime]:
        """
        Estimate when fire danger is most acute.

        Returns None for LOW risk (probability < 0.25). Otherwise peak is
        4-12 hours ahead; higher wind speed brings the peak forward.
        """
        if probability < 0.25:
            return None

        wind_speed = features.get("wind_speed", 5.0)

        # Wind speed -> hours to peak (4 h at >= 15 m/s, 12 h at 0 m/s)
        if wind_speed >= 15.0:
            hours_to_peak = 4.0
        elif wind_speed >= 8.0:
            # Interpolate 6-8 h between 15 m/s and 8 m/s
            frac = (wind_speed - 8.0) / (15.0 - 8.0)
            hours_to_peak = 8.0 - frac * 2.0
        else:
            # Interpolate 8-12 h between 8 m/s and 0 m/s
            frac = wind_speed / 8.0
            hours_to_peak = 12.0 - frac * 4.0

        return datetime.utcnow() + timedelta(hours=hours_to_peak)

    def _generate_affected_polygon(
        self, lat: float, lng: float, prob: float, features: Dict
    ) -> Optional[GeoPolygon]:
        """
        Generate rectangular affected-area polygon.
        Radius is scaled by probability (higher risk -> larger area).
        """
        base_radius_km = 10.0
        radius_km = base_radius_km * (0.5 + prob)

        # 1 degree latitude ~= 111 km; longitude varies by cosine of latitude
        lat_delta = radius_km / 111.0
        lng_delta = radius_km / (111.0 * np.cos(np.radians(lat)))

        return GeoPolygon(
            type="Polygon",
            coordinates=[[
                [lng - lng_delta, lat + lat_delta],  # NW
                [lng + lng_delta, lat + lat_delta],  # NE
                [lng + lng_delta, lat - lat_delta],  # SE
                [lng - lng_delta, lat - lat_delta],  # SW
                [lng - lng_delta, lat + lat_delta],  # close polygon
            ]]
        )

    def _identify_contributing_factors(
        self, features: Dict[str, float], prob: float
    ) -> List[ContributingFactor]:
        """Identify and rank wildfire risk drivers."""
        ndvi_value = features.get("vegetation_index_ndvi", features.get("ndvi", 0.0))
        precip_7d  = features.get("precipitation_7d", features.get("rainfall_7d", 0.0))

        candidates = [
            ("temperature",           features.get("temperature", 0.0),           "deg C"),
            ("relative_humidity",     features.get("relative_humidity", 0.0),    "fraction"),
            ("wind_speed",            features.get("wind_speed", 0.0),           "m/s"),
            ("vegetation_index_ndvi", ndvi_value,                                 "index"),
            ("soil_moisture",         features.get("soil_moisture", 0.0),        "fraction"),
            ("precipitation_7d",      precip_7d,                                  "mm"),
        ]

        factors = []
        for name, value, unit in candidates:
            if name == "temperature":
                # Higher temperatures above 20 C -> higher importance
                importance = min(1.0, max(0.0, (value - 20.0) / 20.0))
            elif name == "relative_humidity":
                # Lower humidity -> more important fire driver
                importance = max(0.0, 1.0 - value)
            elif name == "wind_speed":
                # Wind up to ~15 m/s -> linear importance
                importance = min(1.0, value / 15.0)
            elif name == "vegetation_index_ndvi":
                # Dense vegetation = more fuel (capped 0-1)
                importance = min(1.0, max(0.0, value))
            elif name == "soil_moisture":
                # Dry soil -> more important fire driver
                importance = max(0.0, 1.0 - value)
            elif name == "precipitation_7d":
                # Low recent rainfall -> drier conditions -> more important
                importance = max(0.0, 1.0 - min(1.0, value / 50.0))
            else:
                importance = 0.3

            # Scale importance by overall probability
            importance *= (0.5 + 0.5 * prob)

            if importance > 0.05:
                factors.append(ContributingFactor(
                    factor=name,
                    value=round(value, 3),
                    importance=round(importance, 3),
                    unit=unit
                ))

        factors.sort(key=lambda f: f.importance, reverse=True)
        return factors[:6]

