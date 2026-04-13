"""
File: predictions.py

What this file does:
All Pydantic models (request/response schemas) for the AI prediction API.
Defines PredictionRequest (location, optional context), PredictionResponse
(risk_level, confidence, explanation, SHAP features), HazardType enum,
RiskLevel enum, ModelStatus, and RetrainRequest/Response.

How it connects:
- Imported by ai-engine/app/api/endpoints.py for all route I/O
- Imported by all hazard predictors for typed return values
- Response shapes documented in ai-engine/README.md API reference
- TypeScript types generated from these schemas in client/src/types/
"""

from pydantic import BaseModel, Field, model_validator, validator
from typing import Dict, List, Optional, Any
from datetime import datetime
from enum import Enum

class HazardType(str, Enum):
    """Supported hazard types."""
    FLOOD = "flood"
    HEATWAVE = "heatwave"
    WILDFIRE = "wildfire"
    LANDSLIDE = "landslide"
    SEVERE_STORM = "severe_storm"
    POWER_OUTAGE = "power_outage"
    WATER_SUPPLY = "water_supply_disruption"
    INFRASTRUCTURE = "infrastructure_damage"
    PUBLIC_SAFETY = "public_safety_incident"
    ENVIRONMENTAL = "environmental_hazard"
    DROUGHT = "drought"
    # Training-specific types
    ALL = "all"
    SEVERITY = "severity"
    REPORT_CLASSIFIER = "report_classifier"
    FAKE_DETECTOR = "fake_detector"

class RiskLevel(str, Enum):
    """Risk classification levels."""
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"

class PredictionRequest(BaseModel):
    """
    Request schema for prediction endpoint.
    """
    hazard_type: HazardType = Field(..., description="Type of hazard to predict")
    region_id: str = Field(..., description="Geographic region identifier")
    latitude: float = Field(..., ge=-90, le=90, description="Latitude")
    longitude: float = Field(..., ge=-180, le=180, description="Longitude")
    forecast_horizon: Optional[int] = Field(
        default=48,
        description="Forecast horizon in hours"
    )
    include_contributing_factors: bool = Field(
        default=True,
        description="Include detailed contributing factors"
    )
    model_version: Optional[str] = Field(
        default=None,
        description="Specific model version (auto-selected if not provided)"
    )
    feature_overrides: Optional[Dict[str, float]] = Field(
        default=None,
        description="Real observed values that override feature store defaults (e.g. river_level, rainfall_24h)"
    )

class ContributingFactor(BaseModel):
    """Individual contributing factor with importance weight."""
    factor: str = Field(..., description="Factor name")
    value: float = Field(..., description="Factor value")
    importance: float = Field(..., ge=0, le=1, description="Importance weight 0-1")
    unit: Optional[str] = Field(default=None, description="Measurement unit")

class GeoPolygon(BaseModel):
    """
    GeoJSON-compatible polygon representation.
    """
    type: str = Field(default="Polygon", description="GeoJSON type")
    coordinates: List[List[List[float]]] = Field(
        ...,
        description="Polygon coordinates [[[lng, lat], ...]]"
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_numpy_floats(cls, data):
        """Convert numpy scalar types (e.g. np.float64) to plain Python floats
        and validate basic GeoJSON polygon structure."""
        if isinstance(data, dict) and "coordinates" in data:
            def _to_float(v):
                if isinstance(v, list):
                    return [_to_float(x) for x in v]
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return v
            data = dict(data)
            data["coordinates"] = _to_float(data["coordinates"])

            # Basic GeoJSON polygon validation
            coords = data["coordinates"]
            if isinstance(coords, list):
                for ring_idx, ring in enumerate(coords):
                    if not isinstance(ring, list):
                        continue
                    if len(ring) < 4:
                        raise ValueError(
                            f"Polygon ring {ring_idx} must have at least 4 points "
                            f"(got {len(ring)})"
                        )
                    if ring[0] != ring[-1]:
                        raise ValueError(
                            f"Polygon ring {ring_idx} is not closed "
                            f"(first point {ring[0]} != last point {ring[-1]})"
                        )
        return data

class PredictionResponse(BaseModel):
    """
    CRITICAL: THIS SCHEMA IS THE API CONTRACT
    
    DO NOT MODIFY THIS STRUCTURE AFTER DEPLOYMENT
    
    All hazard modules MUST return predictions following this exact format.
    Adding new hazards must conform to this schema.
    """
    model_version: str = Field(..., description="Model version that generated prediction")
    hazard_type: HazardType = Field(..., description="Type of hazard predicted")
    region_id: str = Field(..., description="Geographic region identifier")
    probability: float = Field(..., ge=0, le=1, description="Probability 0.0-1.0")
    risk_level: RiskLevel = Field(..., description="Classified risk level")
    confidence: float = Field(..., ge=0, le=1, description="Model confidence 0.0-1.0")
    predicted_peak_time: Optional[str] = Field(
        default=None,
        description="ISO 8601 timestamp of predicted peak"
    )
    geo_polygon: Optional[GeoPolygon] = Field(
        default=None,
        description="Affected area polygon (GeoJSON)"
    )
    contributing_factors: List[ContributingFactor] = Field(
        default_factory=list,
        description="Ranked contributing factors"
    )
    
    # Extended metadata (optional additions allowed)
    generated_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="Prediction generation timestamp"
    )
    expires_at: Optional[datetime] = Field(
        default=None,
        description="Prediction expiry timestamp"
    )
    data_sources: Optional[List[str]] = Field(
        default_factory=list,
        description="Data sources used"
    )
    warnings: Optional[List[str]] = Field(
        default_factory=list,
        description="Any warnings or caveats"
    )

    # Model transparency (added for governance / explainability)
    model_type_label: Optional[str] = Field(
        default=None,
        description="supervised | weakly_supervised | rule_based | heuristic_model | experimental"
    )
    shap_explanation: Optional[Dict[str, Any]] = Field(
        default=None,
        description="SHAP feature explanations for this prediction"
    )
    label_strategy: Optional[str] = Field(
        default=None,
        description="How training labels were produced"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "model_version": "flood-scotland-v1.2.0",
                "hazard_type": "flood",
                "region_id": "scotland-northeast",
                "probability": 0.87,
                "risk_level": "High",
                "confidence": 0.92,
                "predicted_peak_time": "2026-03-04T14:30:00Z",
                "geo_polygon": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-2.0948, 57.1720],
                        [-2.0850, 57.1720],
                        [-2.0850, 57.1650],
                        [-2.0948, 57.1650],
                        [-2.0948, 57.1720]
                    ]]
                },
                "contributing_factors": [
                    {
                        "factor": "rainfall_24h",
                        "value": 45.2,
                        "importance": 0.89,
                        "unit": "mm"
                    },
                    {
                        "factor": "river_level",
                        "value": 2.8,
                        "importance": 0.76,
                        "unit": "m"
                    }
                ],
                "generated_at": "2026-03-03T10:00:00Z",
                "data_sources": ["river_gauge", "rainfall_radar", "historical_patterns"]
            }
        }

class ModelStatus(BaseModel):
    """Model health and status information."""
    model_name: str
    model_version: str
    status: str  # "operational", "degraded", "offline"
    last_prediction: Optional[datetime]
    total_predictions: int
    average_latency_ms: Optional[float]
    drift_detected: bool
    last_trained: Optional[datetime]

class HealthResponse(BaseModel):
    """System health response."""
    status: str
    timestamp: datetime
    models_loaded: int
    models_status: List[ModelStatus]

class HazardTypeInfo(BaseModel):
    """Information about a supported hazard type."""
    hazard_type: HazardType
    enabled: bool
    models_available: List[str]
    supported_regions: List[str]
    forecast_horizons: List[int]

class RetrainRequest(BaseModel):
    """Request to trigger model retraining."""
    hazard_type: HazardType
    region_id: str
    model_name: Optional[str] = None
    config_override: Optional[Dict[str, Any]] = None

class RetrainResponse(BaseModel):
    """Response from retraining request."""
    job_id: str
    status: str
    message: str
    estimated_completion: Optional[datetime]
