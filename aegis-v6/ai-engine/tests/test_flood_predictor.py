"""
Module: test_flood_predictor.py

Test_flood_predictor AI engine module.
"""

import pytest
from datetime import datetime, timedelta

from app.schemas.predictions import (
    PredictionRequest,
    PredictionResponse,
    RiskLevel,
    HazardType,
    ContributingFactor,
    GeoPolygon,
)

# Schema validation tests

class TestPredictionRequest:
    """Validate PredictionRequest schema."""

    def test_valid_flood_request(self):
        req = PredictionRequest(
            hazard_type=HazardType.FLOOD,
            region_id="scotland",
            latitude=57.15,
            longitude=-2.09,
        )
        assert req.hazard_type == HazardType.FLOOD
        assert req.forecast_horizon == 48  # default

    def test_request_with_all_fields(self):
        req = PredictionRequest(
            hazard_type=HazardType.FLOOD,
            region_id="england",
            latitude=51.5,
            longitude=-0.12,
            forecast_horizon=12,
            include_contributing_factors=False,
            model_version="ml-v2.0.0",
            feature_overrides={"river_level": 3.2, "rainfall_24h": 45.0},
        )
        assert req.forecast_horizon == 12
        assert req.feature_overrides["river_level"] == 3.2

    def test_rejects_invalid_latitude(self):
        with pytest.raises(Exception):
            PredictionRequest(
                hazard_type=HazardType.FLOOD,
                region_id="test",
                latitude=91,
                longitude=0,
            )

    def test_rejects_invalid_longitude(self):
        with pytest.raises(Exception):
            PredictionRequest(
                hazard_type=HazardType.FLOOD,
                region_id="test",
                latitude=0,
                longitude=181,
            )

    def test_rejects_missing_required_fields(self):
        with pytest.raises(Exception):
            PredictionRequest(latitude=50, longitude=0)  # type: ignore

class TestPredictionResponse:
    """Validate PredictionResponse schema (API contract)."""

    def test_valid_response(self):
        resp = PredictionResponse(
            model_version="ml-v2.0.0",
            hazard_type=HazardType.FLOOD,
            region_id="scotland",
            probability=0.75,
            risk_level=RiskLevel.HIGH,
            confidence=0.82,
        )
        assert resp.probability == 0.75
        assert resp.risk_level == RiskLevel.HIGH
        assert resp.generated_at is not None

    def test_response_with_full_metadata(self):
        resp = PredictionResponse(
            model_version="ml-v2.0.0",
            hazard_type=HazardType.FLOOD,
            region_id="scotland",
            probability=0.90,
            risk_level=RiskLevel.CRITICAL,
            confidence=0.88,
            predicted_peak_time=(datetime.utcnow() + timedelta(hours=3)).isoformat(),
            geo_polygon=GeoPolygon(
                type="Polygon",
                coordinates=[[[-2.1, 57.1], [-2.0, 57.1], [-2.0, 57.2], [-2.1, 57.2], [-2.1, 57.1]]],
            ),
            contributing_factors=[
                ContributingFactor(factor="River Level", value=3.5, importance=0.9, unit="m"),
                ContributingFactor(factor="Rainfall 24h", value=45.0, importance=0.7, unit="mm"),
            ],
            data_sources=["river_gauge", "rainfall_radar"],
            warnings=["Rapid river rise detected"],
        )
        assert resp.risk_level == RiskLevel.CRITICAL
        assert len(resp.contributing_factors) == 2
        assert resp.geo_polygon is not None

    def test_probability_must_be_0_to_1(self):
        with pytest.raises(Exception):
            PredictionResponse(
                model_version="v1",
                hazard_type=HazardType.FLOOD,
                region_id="test",
                probability=1.5,
                risk_level=RiskLevel.HIGH,
                confidence=0.5,
            )

    def test_confidence_must_be_0_to_1(self):
        with pytest.raises(Exception):
            PredictionResponse(
                model_version="v1",
                hazard_type=HazardType.FLOOD,
                region_id="test",
                probability=0.5,
                risk_level=RiskLevel.HIGH,
                confidence=-0.1,
            )

class TestRiskLevel:
    """Validate risk-level enum values."""

    def test_all_levels_present(self):
        assert RiskLevel.LOW.value == "Low"
        assert RiskLevel.MEDIUM.value == "Medium"
        assert RiskLevel.HIGH.value == "High"
        assert RiskLevel.CRITICAL.value == "Critical"

    def test_level_count(self):
        assert len(RiskLevel) == 4

class TestHazardType:
    """Validate hazard-type enum completeness."""

    REQUIRED_TYPES = [
        "flood", "heatwave", "wildfire", "landslide", "severe_storm",
        "power_outage", "water_supply_disruption", "infrastructure_damage",
        "public_safety_incident", "environmental_hazard", "drought",
    ]

    def test_all_operational_types(self):
        enum_values = [e.value for e in HazardType]
        for t in self.REQUIRED_TYPES:
            assert t in enum_values, f"Missing HazardType: {t}"

    def test_training_types_present(self):
        enum_values = [e.value for e in HazardType]
        assert "all" in enum_values
        assert "severity" in enum_values

class TestContributingFactor:
    """Validate ContributingFactor schema."""

    def test_valid_factor(self):
        cf = ContributingFactor(factor="River Level", value=3.5, importance=0.9, unit="m")
        assert cf.importance == 0.9

    def test_importance_must_be_0_to_1(self):
        with pytest.raises(Exception):
            ContributingFactor(factor="x", value=1, importance=1.5)

    def test_unit_is_optional(self):
        cf = ContributingFactor(factor="test", value=0, importance=0.5)
        assert cf.unit is None

class TestGeoPolygon:
    """Validate GeoPolygon schema."""

    def test_valid_polygon(self):
        poly = GeoPolygon(
            coordinates=[[[-2.1, 57.1], [-2.0, 57.1], [-2.0, 57.2], [-2.1, 57.2], [-2.1, 57.1]]],
        )
        assert poly.type == "Polygon"
        assert len(poly.coordinates[0]) == 5

    def test_default_type(self):
        poly = GeoPolygon(coordinates=[[[0, 0], [1, 0], [1, 1], [0, 0]]])
        assert poly.type == "Polygon"
