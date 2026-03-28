"""
 AEGIS AI ENGINE — Heatwave Prediction Module
"""

from typing import Dict, List, Optional, Any, Tuple
import numpy as np
from datetime import datetime, timedelta
from loguru import logger

from app.schemas.predictions import *
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.hazards.shap_explainer import explain_prediction

class HeatwavePredictor:
    """
    Heatwave prediction module focusing on:
    - Temperature anomaly detection
    - Duration prediction
    - Urban heat island effects
    - Vulnerable population impact
    """
    
    def __init__(self, model_registry: ModelRegistry, feature_store: FeatureStore):
        self.model_registry = model_registry
        self.feature_store = feature_store
        self.hazard_type = HazardType.HEATWAVE
        self._last_shap = None
        self._model_type_label = "supervised"
        self._label_strategy = "Trained on historical heatwave event records"
        logger.info("Heatwave prediction module initialized")
    
    async def predict(self, request: PredictionRequest) -> PredictionResponse:
        """Generate heatwave prediction."""
        
        logger.info(f"Heatwave prediction request: ({request.latitude}, {request.longitude})")
        start_time = datetime.utcnow()
        
        features = await self.feature_store.get_all_features(
            request.latitude, request.longitude, request.region_id
        )
        
        model_metadata = await self.model_registry.get_metadata(
            self.hazard_type.value, request.region_id, request.model_version
        )
        if not model_metadata and request.region_id != 'uk-default':
            model_metadata = await self.model_registry.get_metadata(
                self.hazard_type.value, 'uk-default', request.model_version
            )

        if model_metadata:
            model = await self.model_registry.get_model(
                self.hazard_type.value, model_metadata.region_id, model_metadata.version
            )
            if model:
                probability, confidence = await self._predict_with_model(model, features, model_metadata)
            else:
                probability, confidence = self._stub_prediction(features)
        else:
            probability, confidence = self._stub_prediction(features)
        
        risk_level = self._classify_risk(probability)
        predicted_peak_time = self._estimate_peak_time(probability, features)
        geo_polygon = self._generate_affected_polygon(request.latitude, request.longitude, probability, features)
        contributing_factors = self._identify_contributing_factors(features, probability)
        
        execution_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        version = model_metadata.version if model_metadata else "stub-v1.0.0"
        
        self.model_registry.record_prediction(
            self.hazard_type.value, request.region_id, execution_time, version
        )
        
        logger.success(f"Heatwave prediction: prob={probability:.2f}, risk={risk_level.value}")
        
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
            expires_at=datetime.utcnow() + timedelta(days=3),
            data_sources=["temperature_forecast", "humidity", "urban_density", "historical_patterns"],
            warnings=["Vulnerable populations at risk"] if probability > 0.6 else [],
            model_type_label=self._model_type_label,
            shap_explanation=self._last_shap,
            label_strategy=self._label_strategy,
        )
    
    async def _predict_with_model(self, model: Any, features: Dict[str, float], metadata: Any) -> Tuple[float, float]:
        """Use trained model."""
        try:
            feature_vector = np.array([features.get(f, 0.0) for f in metadata.feature_names]).reshape(1, -1)
            if hasattr(model, 'predict_proba'):
                probability = model.predict_proba(feature_vector)[0, 1]
            else:
                probability = float(model.predict(feature_vector)[0])
            probability = np.clip(probability, 0.0, 1.0)
            raw_conf = metadata.performance_metrics.get('roc_auc') or metadata.performance_metrics.get('f1_score', 0.65)
            confidence = round(min(0.99, max(0.40, float(raw_conf))), 3)
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
            logger.error(f"Model error: {e}")
            return self._stub_prediction(features)
    
    def _stub_prediction(self, features: Dict[str, float]) -> Tuple[float, float]:
        """Temperature anomaly-based heatwave estimation."""
        
        temperature = features.get('temperature', 15)
        humidity = features.get('humidity', 0.6)
        wind_speed = features.get('wind_speed', 5)
        seasonal_anomaly = features.get('seasonal_anomaly', 0.0)
        impervious_ratio = features.get('impervious_surface_ratio', 0.3)
        
        # Temperature threshold (climate-zone dependent)
        # For temperate regions like Scotland, 25°C+ is unusual
        threshold_temp = 22.0
        
        # Temperature excess factor
        temp_excess = max(0.0, temperature - threshold_temp)
        temp_factor = min(1.0, temp_excess / 10.0)
        
        # Humidity amplification (high humidity makes heat worse)
        humidity_factor = humidity
        
        # Wind reduction (low wind = heat stays)
        wind_factor = 1.0 - min(1.0, wind_speed / 10.0)
        
        # Urban heat island effect
        urban_factor = impervious_ratio
        
        # Seasonal context (summer anomalies more serious)
        # seasonal_anomaly ranges -1 to 1, positive in summer
        seasonal_factor = max(0.0, seasonal_anomaly)
        
        # Persistence indicator (stub - would use forecast data)
        persistence_factor = 0.5
        
        # Combined probability
        probability = (
            temp_factor * 0.40 +
            humidity_factor * 0.15 +
            wind_factor * 0.10 +
            urban_factor * 0.15 +
            seasonal_factor * 0.10 +
            persistence_factor * 0.10
        )
        
        probability = np.clip(probability, 0.0, 1.0)
        confidence = 0.75
        
        return float(probability), float(confidence)
    
    def _classify_risk(self, probability: float) -> RiskLevel:
        """Classify heatwave severity."""
        if probability >= 0.75:
            return RiskLevel.CRITICAL
        elif probability >= 0.55:
            return RiskLevel.HIGH
        elif probability >= 0.30:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _estimate_peak_time(self, probability: float, features: Dict[str, float]) -> Optional[datetime]:
        """Estimate heatwave peak."""
        if probability < 0.3:
            return None
        # Heatwaves typically peak within 24-72 hours
        hours_to_peak = 24 + (1.0 - probability) * 48
        return datetime.utcnow() + timedelta(hours=hours_to_peak)
    
    def _generate_affected_polygon(self, lat: float, lng: float, prob: float, features: Dict) -> Optional[GeoPolygon]:
        """Generate affected area polygon - urban areas more affected."""
        # Urban heat islands are localized
        base_radius = 5.0 if features.get('impervious_surface_ratio', 0) > 0.5 else 15.0
        radius_km = base_radius * (0.5 + prob)
        
        lat_delta = radius_km / 111.0
        lng_delta = radius_km / (111.0 * np.cos(np.radians(lat)))
        
        return GeoPolygon(
            type="Polygon",
            coordinates=[[
                [lng - lng_delta, lat + lat_delta],
                [lng + lng_delta, lat + lat_delta],
                [lng + lng_delta, lat - lat_delta],
                [lng - lng_delta, lat - lat_delta],
                [lng - lng_delta, lat + lat_delta],
            ]]
        )
    
    def _identify_contributing_factors(self, features: Dict[str, float], prob: float) -> List[ContributingFactor]:
        """Identify heatwave drivers."""
        candidates = [
            ("temperature", features.get('temperature', 0), "°C"),
            ("humidity", features.get('humidity', 0), "fraction"),
            ("wind_speed", features.get('wind_speed', 0), "m/s"),
            ("impervious_surface_ratio", features.get('impervious_surface_ratio', 0), "fraction"),
            ("seasonal_anomaly", features.get('seasonal_anomaly', 0), "index"),
        ]
        
        factors = []
        for name, value, unit in candidates:
            if name == "temperature":
                importance = min(1.0, max(0.0, (value - 20.0) / 10.0))
            elif name == "humidity":
                importance = value
            elif name == "wind_speed":
                importance = 1.0 - min(1.0, value / 10.0)
            elif name == "impervious_surface_ratio":
                importance = value
            else:
                importance = 0.3
            
            importance *= (0.5 + 0.5 * prob)
            
            if importance > 0.1:
                factors.append(ContributingFactor(
                    factor=name, value=round(value, 2), importance=round(importance, 3), unit=unit
                ))
        
        factors.sort(key=lambda f: f.importance, reverse=True)
        return factors[:5]
