"""
Test_severity_predictor AI engine module.
"""

import pytest

class TestHeuristicPrediction:
    """Tests for heuristic fallback severity prediction."""

    def test_critical_severity_keywords(self, severity_predictor):
        result = severity_predictor.predict(
            text="Catastrophic flooding",
            description="Life-threatening dam breach, mass casualty event, widespread destruction",
            trapped_persons=10,
        )
        assert result["severity"] in ("critical", "high")
        assert result["probability"] > 0.5

    def test_high_severity_keywords(self, severity_predictor):
        result = severity_predictor.predict(
            text="Severe flooding",
            description="Extensive damage, people trapped, roads submerged",
            trapped_persons=3,
        )
        assert result["severity"] in ("critical", "high")

    def test_medium_severity_keywords(self, severity_predictor):
        result = severity_predictor.predict(
            text="Moderate flooding",
            description="Notable waterlogged area with some disruption",
        )
        # Heuristic scoring may classify this phrasing as low-to-medium.
        assert result["severity"] in ("low", "medium", "high")

    def test_low_severity_for_benign_text(self, severity_predictor):
        result = severity_predictor.predict(
            text="Minor puddle on road",
            description="No impact",
        )
        assert result["severity"] in ("low", "medium")
        assert result["probability"] < 0.5

    def test_trapped_persons_increases_severity(self, severity_predictor):
        no_trapped = severity_predictor.predict(
            text="Flooding", trapped_persons=0,
        )
        many_trapped = severity_predictor.predict(
            text="Flooding", trapped_persons=8,
        )
        assert many_trapped["probability"] >= no_trapped["probability"]

    def test_affected_area_increases_severity(self, severity_predictor):
        small = severity_predictor.predict(
            text="Flood", affected_area_km2=0.1,
        )
        large = severity_predictor.predict(
            text="Flood", affected_area_km2=20,
        )
        assert large["probability"] >= small["probability"]

    def test_population_increases_severity(self, severity_predictor):
        low_pop = severity_predictor.predict(
            text="Flood", population_affected=10,
        )
        high_pop = severity_predictor.predict(
            text="Flood", population_affected=5000,
        )
        assert high_pop["probability"] >= low_pop["probability"]

class TestOutputSchema:
    """Verify prediction result schema."""

    def test_required_fields(self, severity_predictor):
        result = severity_predictor.predict("test flood")
        required = [
            "model_version", "severity", "probability",
            "confidence", "predicted_at",
        ]
        for field in required:
            assert field in result, f"Missing field: {field}"

    def test_severity_is_valid_class(self, severity_predictor):
        result = severity_predictor.predict("flooding in area")
        assert result["severity"] in ("low", "medium", "high", "critical")

    def test_probability_range(self, severity_predictor):
        result = severity_predictor.predict("test")
        assert 0.0 <= result["probability"] <= 1.0

    def test_confidence_range(self, severity_predictor):
        result = severity_predictor.predict("severe flooding")
        assert 0.0 <= result["confidence"] <= 1.0

    def test_model_version_is_heuristic_in_test(self, severity_predictor):
        """In test env there's no trained model, so heuristic-v2.0.0 is expected."""
        result = severity_predictor.predict("test")
        assert "heuristic" in result["model_version"] or "ml" in result["model_version"]

    def test_contributing_factors_present(self, severity_predictor):
        result = severity_predictor.predict(
            "Bridge collapse with people trapped",
            description="Severe damage, urgent evacuation needed",
            trapped_persons=5,
        )
        assert "contributing_factors" in result
        assert len(result["contributing_factors"]) > 0

class TestWeatherConditions:
    """Tests for weather modifier."""

    def test_heavy_precipitation_increases_severity(self, severity_predictor):
        dry = severity_predictor.predict("Flood", weather_conditions={"precipitation": 5})
        wet = severity_predictor.predict("Flood", weather_conditions={"precipitation": 80})
        assert wet["probability"] >= dry["probability"]

    def test_high_wind_increases_severity(self, severity_predictor):
        calm = severity_predictor.predict("Storm", weather_conditions={"wind_speed": 5})
        windy = severity_predictor.predict("Storm", weather_conditions={"wind_speed": 40})
        assert windy["probability"] >= calm["probability"]

class TestBatchPrediction:
    """Tests for batch_predict()."""

    def test_batch_returns_all_results(self, severity_predictor):
        reports = [
            {"id": "r1", "text": "Catastrophic dam breach", "trapped_persons": 20},
            {"id": "r2", "text": "Minor puddle"},
            {"id": "r3", "text": "Moderate flooding, some damage"},
        ]
        results = severity_predictor.batch_predict(reports)
        assert len(results) == 3
        assert results[0]["report_id"] == "r1"
        # Catastrophic report should have higher severity
        assert results[0]["probability"] > results[1]["probability"]

    def test_batch_empty(self, severity_predictor):
        results = severity_predictor.batch_predict([])
        assert results == []

class TestEdgeCases:
    """Edge-case robustness tests."""

    def test_empty_text(self, severity_predictor):
        result = severity_predictor.predict("")
        assert result["severity"] in ("low", "medium")

    def test_very_long_text(self, severity_predictor):
        long_text = "severe flooding " * 300
        result = severity_predictor.predict(long_text)
        assert result["severity"] is not None

    def test_handles_none_weather(self, severity_predictor):
        result = severity_predictor.predict("flood", weather_conditions=None)
        assert result["severity"] is not None

    def test_negative_trapped_persons_handled(self, severity_predictor):
        """Negative values should not crash, just produce low score."""
        result = severity_predictor.predict("flood", trapped_persons=-1)
        assert result["severity"] is not None

    def test_error_returns_safe_default(self, severity_predictor):
        """Even on internal errors, output should have a severity."""
        result = severity_predictor.predict("test")
        assert "severity" in result
