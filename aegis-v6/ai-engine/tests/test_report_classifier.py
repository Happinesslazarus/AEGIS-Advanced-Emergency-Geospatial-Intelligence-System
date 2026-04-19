"""
Test_report_classifier AI engine module.
"""

import pytest

class TestClassifySingleReport:
    """Tests for ReportClassifier.classify()."""

    def test_flood_classification(self, report_classifier):
        result = report_classifier.classify(
            "River burst its banks, flooding residential area",
            description="Water level rising rapidly, submerged roads",
        )
        assert result["primary_hazard"] == "flood"
        assert result["confidence"] > 0.5
        assert result["probability"] > 0.5
        assert "flood" in result["all_hazards_detected"]

    def test_wildfire_classification(self, report_classifier):
        result = report_classifier.classify(
            "Large wildfire spreading on hillside",
            description="Smoke visible for miles, flames approaching houses",
        )
        assert result["primary_hazard"] == "wildfire"
        assert result["confidence"] > 0.5

    def test_earthquake_classification(self, report_classifier):
        result = report_classifier.classify(
            "Strong earthquake tremor felt across the city",
            description="Ground shaking for several seconds, aftershock expected",
        )
        assert result["primary_hazard"] == "earthquake"

    def test_storm_classification(self, report_classifier):
        result = report_classifier.classify(
            "Hurricane approaching coast with strong winds and gale force gusts",
        )
        assert result["primary_hazard"] == "storm"

    def test_drought_classification(self, report_classifier):
        result = report_classifier.classify(
            "Severe drought, water shortage affecting crops",
            description="Reservoir empty, wells dried up",
        )
        assert result["primary_hazard"] == "drought"

    def test_landslide_classification(self, report_classifier):
        result = report_classifier.classify(
            "Major landslide blocking road after heavy rain, mudslide risk",
        )
        assert result["primary_hazard"] == "landslide"

    def test_heatwave_classification(self, report_classifier):
        result = report_classifier.classify(
            "Extreme heat wave causing heat exhaustion across the region",
        )
        assert result["primary_hazard"] == "heatwave"

    def test_unknown_classification(self, report_classifier):
        result = report_classifier.classify(
            "The quick brown fox jumps over the lazy dog",
        )
        assert result["primary_hazard"] == "unknown"
        assert result["confidence"] <= 0.4

    def test_empty_text(self, report_classifier):
        result = report_classifier.classify("")
        assert result["primary_hazard"] == "unknown"
        assert result["confidence"] <= 0.4

    def test_confidence_range(self, report_classifier):
        result = report_classifier.classify("flooding in residential area")
        assert 0.0 <= result["confidence"] <= 1.0
        assert 0.0 <= result["probability"] <= 1.0

    def test_model_version_present(self, report_classifier):
        result = report_classifier.classify("test")
        assert "model_version" in result
        assert result["model_version"] == "keyword-v1.0.0"

    def test_classified_at_timestamp(self, report_classifier):
        result = report_classifier.classify("flood alert")
        assert "classified_at" in result

    def test_multiple_hazards_detected(self, report_classifier):
        result = report_classifier.classify(
            "Flooding caused by storm, wildfire smoke also visible",
        )
        detected = result["all_hazards_detected"]
        assert len(detected) >= 2

    def test_location_context_used(self, report_classifier):
        result = report_classifier.classify(
            "Water rising",
            location="near river flood plain",
        )
        assert result["primary_hazard"] == "flood"

class TestSeverityExtraction:
    """Tests for severity indicator extraction."""

    def test_high_severity_keywords(self, report_classifier):
        result = report_classifier.classify(
            "Emergency: catastrophic flooding, life-threatening conditions",
        )
        assert result["severity_hint"] == "high"

    def test_low_severity_keywords(self, report_classifier):
        result = report_classifier.classify(
            "Minor isolated flooding, minimal impact",
        )
        assert result["severity_hint"] == "low"

    def test_impact_indicators(self, report_classifier):
        result = report_classifier.classify(
            "Bridge collapsed, people trapped, urgent evacuation needed",
        )
        impact = result["impact_indicators"]
        assert impact["casualties"] is True
        assert impact["evacuation"] is True
        assert impact["infrastructure"] is True
        assert impact["urgent_response"] is True

class TestBatchClassification:
    """Tests for batch_classify()."""

    def test_batch_returns_all_results(self, report_classifier):
        reports = [
            {"id": "r1", "text": "Flooding on Main Street"},
            {"id": "r2", "text": "Wildfire spreading rapidly"},
            {"id": "r3", "text": "Minor earthquake tremor"},
        ]
        results = report_classifier.batch_classify(reports)
        assert len(results) == 3
        assert results[0]["report_id"] == "r1"
        assert results[0]["primary_hazard"] == "flood"
        assert results[1]["primary_hazard"] == "wildfire"
        assert results[2]["primary_hazard"] == "earthquake"

    def test_batch_empty_list(self, report_classifier):
        results = report_classifier.batch_classify([])
        assert results == []

class TestEdgeCases:
    """Edge-case / robustness tests."""

    def test_very_long_text(self, report_classifier):
        long_text = "flood " * 500
        result = report_classifier.classify(long_text)
        assert result["primary_hazard"] == "flood"

    def test_non_english_text(self, report_classifier):
        result = report_classifier.classify("大洪水が発生しました")
        # Keywords are English, so non-English text should be unknown
        assert result["primary_hazard"] == "unknown"

    def test_special_characters(self, report_classifier):
        result = report_classifier.classify("!!!@@@###$$$%%%^^^&&&***")
        assert result["primary_hazard"] == "unknown"

    def test_mixed_case(self, report_classifier):
        result = report_classifier.classify("FLOOD FLOODING FLOODED")
        assert result["primary_hazard"] == "flood"
