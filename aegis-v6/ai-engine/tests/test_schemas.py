"""
Test_schemas AI engine module.
"""

import pytest
from app.schemas.predictions import HazardType, RiskLevel

CORE_TYPES = [
    'flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide',
    'power_outage', 'water_supply_disruption', 'infrastructure_damage',
    'public_safety_incident', 'environmental_hazard',
]

def test_hazard_type_has_all_core_types():
    enum_values = [e.value for e in HazardType]
    for t in CORE_TYPES:
        assert t in enum_values, f"Missing HazardType: {t}"

def test_risk_levels():
    assert RiskLevel.LOW.value == "Low"
    assert RiskLevel.MEDIUM.value == "Medium"
    assert RiskLevel.HIGH.value == "High"
    assert RiskLevel.CRITICAL.value == "Critical"

def test_hazard_type_count():
    # 10 core + training types (ALL, SEVERITY, REPORT_CLASSIFIER, FAKE_DETECTOR)
    assert len(HazardType) >= 14
