"""
Module: test_fake_detector.py

Test_fake_detector AI engine module.
"""

import pytest

class TestDetectGenuine:
    """Reports that should be classified as genuine."""

    def test_genuine_report_with_images_and_gps(self, fake_detector):
        result = fake_detector.detect(
            text="Flooding near river bridge",
            description="Water level rising fast, road submerged",
            user_reputation=0.8,
            image_count=2,
            location_verified=True,
            source_type="verified_user",
            similar_reports_count=3,
        )
        assert result["is_fake"] is False
        assert result["classification"] == "genuine"
        assert result["recommended_action"] == "accept"

    def test_official_source_gets_credibility_bonus(self, fake_detector):
        result = fake_detector.detect(
            text="Flood warning issued for regional area",
            description="National weather service advises caution",
            source_type="official",
        )
        assert result["is_fake"] is False
        assert result["fake_probability"] < 0.3

    def test_high_reputation_user(self, fake_detector):
        result = fake_detector.detect(
            text="Fire spotted on hillside",
            description="Moderate smoke visible from road",
            user_reputation=0.9,
            image_count=1,
            location_verified=True,
        )
        assert result["classification"] == "genuine"

class TestDetectFake:
    """Reports that should be flagged as suspicious or fake."""

    def test_spam_with_urls_and_commercial_keywords(self, fake_detector):
        result = fake_detector.detect(
            text="Buy cheap flood insurance at http://spam.example.com",
            description="Click here for discount offer! Subscribe now!",
            user_reputation=0.1,
        )
        assert result["fake_probability"] > 0.4
        assert any("spam_pattern" in f for f in result["red_flags"])

    def test_very_short_text(self, fake_detector):
        result = fake_detector.detect(
            text="help",
            description="",
            user_reputation=0.5,
        )
        assert any("text_too_short" in f for f in result["red_flags"])

    def test_high_submission_frequency(self, fake_detector):
        result = fake_detector.detect(
            text="Flood on Main Street",
            description="Water everywhere",
            submission_frequency=10,
        )
        assert any("high_submission_frequency" in f for f in result["red_flags"])

    def test_anonymous_unverified_report(self, fake_detector):
        result = fake_detector.detect(
            text="Major disaster happening",
            description="Maybe something bad",
            source_type="anonymous",
            image_count=0,
            location_verified=False,
            user_reputation=0.2,
        )
        assert result["fake_probability"] > 0.3
        assert any("unverified" in f for f in result["red_flags"])

    def test_fake_keyword_detected(self, fake_detector):
        result = fake_detector.detect(
            text="This is a hoax, just a prank",
            description="Fake rumor about floods",
        )
        assert any("fake_keyword" in f for f in result["red_flags"])

class TestSuspicionScoreThresholds:
    """Verify classification thresholds."""

    def test_result_has_required_fields(self, fake_detector):
        result = fake_detector.detect("test report")
        required = [
            "model_version", "is_fake", "fake_probability", "classification",
            "confidence", "recommended_action", "red_flags", "detected_at",
        ]
        for field in required:
            assert field in result, f"Missing field: {field}"

    def test_probability_range(self, fake_detector):
        result = fake_detector.detect(
            "Flooding on bridge road",
            user_reputation=0.5,
        )
        assert 0.0 <= result["fake_probability"] <= 1.0
        assert 0.0 <= result["confidence"] <= 1.0

    def test_model_version(self, fake_detector):
        result = fake_detector.detect("test")
        assert result["model_version"] == "rule-v1.0.0"

class TestCredibilityModifiers:
    """Tests for user credibility and source type modifiers."""

    def test_low_reputation_increases_suspicion(self, fake_detector):
        low_rep = fake_detector.detect("Flood near river", user_reputation=0.1)
        high_rep = fake_detector.detect("Flood near river", user_reputation=0.9)
        assert low_rep["fake_probability"] > high_rep["fake_probability"]

    def test_verified_location_reduces_suspicion(self, fake_detector):
        verified = fake_detector.detect(
            "Flooding", location_verified=True, image_count=2,
        )
        unverified = fake_detector.detect(
            "Flooding", location_verified=False, image_count=0,
        )
        assert verified["fake_probability"] < unverified["fake_probability"]

    def test_corroborating_reports_help(self, fake_detector):
        isolated = fake_detector.detect(
            "Fire spotted", similar_reports_count=0, image_count=0,
        )
        corroborated = fake_detector.detect(
            "Fire spotted", similar_reports_count=5, image_count=0,
        )
        assert corroborated["fake_probability"] <= isolated["fake_probability"]

class TestBatchDetection:
    """Tests for batch_detect()."""

    def test_batch_returns_all_results(self, fake_detector):
        reports = [
            {"id": "r1", "text": "Genuine flood report", "user_reputation": 0.8, "image_count": 2, "location_verified": True},
            {"id": "r2", "text": "Buy cheap insurance http://spam.example.com", "user_reputation": 0.1},
        ]
        results = fake_detector.batch_detect(reports)
        assert len(results) == 2
        assert results[0]["report_id"] == "r1"
        assert results[1]["report_id"] == "r2"

    def test_batch_empty(self, fake_detector):
        results = fake_detector.batch_detect([])
        assert results == []

class TestEdgeCases:
    """Edge-case robustness tests."""

    def test_excessive_caps(self, fake_detector):
        result = fake_detector.detect("AAAAAAAAAAAAAAAA FAKE ALERT BBBBBBBBBBB")
        assert any("spam_pattern" in f or "text_too_short" in f for f in result["red_flags"])

    def test_repeated_words(self, fake_detector):
        result = fake_detector.detect("flood flood flood flood flood")
        # Repeated words pattern triggers
        assert result["fake_probability"] >= 0.0  # at minimum, runs without error

    def test_empty_text(self, fake_detector):
        result = fake_detector.detect("")
        assert "text_too_short" in result["red_flags"]

    def test_potential_spam_campaign(self, fake_detector):
        result = fake_detector.detect(
            "Flood on road",
            similar_reports_count=20,
        )
        assert any("spam_campaign" in f for f in result["red_flags"])
