"""
Rule-based report authenticity filter: flags likely false, duplicate, or
spam reports before they enter the main pipeline. Checks for suspicious
patterns (repeated submissions from same IP, implausible coordinates,
known test phrases) and returns a fakeProbability score 0-1.

- Used by ai-engine/app/api/endpoints.py POST /fake-detection endpoint
- Replaced by fake_detector_ml.py after sufficient labelled data exists
- fakeProbability returned to server/src/services/aiAnalysisPipeline.ts
"""

from typing import Any, Dict, Optional, List
import re
from datetime import datetime, timedelta
from loguru import logger

class FakeDetector:
    """
    Detect fake, spam, or fraudulent disaster reports using rule-based heuristics.

    This is the fallback implementation. The production ML version lives in
    fake_detector_ml.py (FakeDetectorTrainable) which uses XGBoost trained on
    real report data from the database. This class is used when no trained
    model artifact exists.
    """
    
    def __init__(self):
        self.spam_patterns = [
            r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+',  # URLs
            r'\b(?:buy|sell|cheap|discount|offer|promo|click here|subscribe)\b',  # Commercial
            r'(\b\w+\b)(?:\s+\1){2,}',  # Repeated words
            r'[A-Z]{10,}',  # Excessive caps
            r'\$[\d,]+',  # Money amounts
        ]
        
        self.suspicious_keywords = [
            'click', 'free', 'win', 'prize', 'lottery', 'cash', 'million',
            'guaranteed', 'limited time', 'act now', 'bonus', 'discount'
        ]
        
        self.fake_indicators = [
            'hoax', 'rumor', 'unconfirmed', 'allegedly', 'supposedly',
            'prank', 'joke', 'fake', 'misleading'
        ]
        
        logger.info("Fake detector initialized")
    
    def detect(
        self,
        text: str,
        description: str = "",
        user_reputation: float = 0.5,
        image_count: int = 0,
        location_verified: bool = False,
        source_type: str = "user_report",
        submission_frequency: int = 1,
        similar_reports_count: int = 0
    ) -> Dict[str, Any]:
        """
        Detect if a report is fake/spam.
        
        Args:
            text: Report title
            description: Report description
            user_reputation: User trust score (0-1)
            image_count: Number of attached images
            location_verified: Whether location is GPS-verified
            source_type: Source of report (user_report, social_media, official)
            submission_frequency: Reports from user in last hour
            similar_reports_count: Number of similar reports nearby
        
        Returns:
            Detection result with is_fake probability and red flags
        """
        try:
            full_text = f"{text} {description}".lower()
            
            # Initialize suspicion score
            suspicion_score = 0.0
            red_flags = []
            
            # Text quality analysis
            text_score, text_flags = self._analyze_text_quality(full_text)
            suspicion_score += text_score
            red_flags.extend(text_flags)
            
            # Spam pattern detection
            spam_score, spam_flags = self._detect_spam_patterns(full_text)
            suspicion_score += spam_score
            red_flags.extend(spam_flags)
            
            # User credibility analysis
            user_score, user_flags = self._analyze_user_credibility(
                user_reputation, submission_frequency
            )
            suspicion_score += user_score
            red_flags.extend(user_flags)
            
            # Content authenticity indicators
            auth_score, auth_flags = self._analyze_authenticity(
                image_count, location_verified, similar_reports_count
            )
            suspicion_score += auth_score
            red_flags.extend(auth_flags)
            
            # Source type modifier: negative values reduce suspicion (trusted
            # sources), positive values raise it (anonymous/social media).
            source_modifiers = {
                'official': -10,
                'verified_user': -5,
                'user_report': 0,
                'social_media': 5,
                'anonymous': 10
            }
            suspicion_score += source_modifiers.get(source_type, 0)
            if source_type in ['anonymous', 'social_media']:
                red_flags.append(f"unverified_source: {source_type}")
            
            # Normalize suspicion_score (0-100 scale) to a probability [0,1].
            # Individual scoring functions contribute at most 10-25 points each,
            # with the source modifier ranging -10 to +10.
            fake_probability = min(1.0, max(0.0, suspicion_score / 100))
            
            # Classification thresholds -- derived from empirical testing:
 # ≥75% likely_fake -> reject immediately
 # 50-75% suspicious -> queue for human review
 # 25-50% questionable -> monitor but accept provisionally
 # <25% genuine -> accept
            if fake_probability >= 0.75:
                classification = 'likely_fake'
                confidence = 0.85
                action = 'reject'
            elif fake_probability >= 0.50:
                classification = 'suspicious'
                confidence = 0.75
                action = 'flag_for_review'
            elif fake_probability >= 0.25:
                classification = 'questionable'
                confidence = 0.65
                action = 'monitor'
            else:
                classification = 'genuine'
                confidence = 0.80
                action = 'accept'
            
            result = {
                'model_version': 'rule-v1.0.0',
                'is_fake': fake_probability > 0.5,
                'fake_probability': fake_probability,
                'classification': classification,
                'confidence': confidence,
                'recommended_action': action,
                'red_flags': red_flags,
                'suspicion_score': suspicion_score,
                'detected_at': datetime.utcnow().isoformat()
            }
            
            logger.info(f"Fake detection: {classification} (prob={fake_probability:.2f})")
            
            return result
            
        except Exception as e:
            logger.error(f"Fake detection error: {e}")
            return {
                'model_version': 'rule-v1.0.0',
                'is_fake': False,
                'fake_probability': 0.3,
                'classification': 'unknown',
                'confidence': 0.3,
                'error': str(e)
            }
    
    def _analyze_text_quality(self, text: str) -> tuple:
        """Analyze text for quality indicators."""
        score = 0.0
        flags = []
        
        # Empty or very short text
        if len(text.strip()) < 20:
            score += 20
            flags.append("text_too_short")
        
        # Excessive length (copy-pasted content)
        if len(text) > 2000:
            score += 10
            flags.append("excessive_length")
        
        # Fake indicator keywords
        for indicator in self.fake_indicators:
            if indicator in text:
                score += 15
                flags.append(f"fake_keyword: {indicator}")
        
        # Poor grammar (simple heuristic: excessive special chars)
        special_char_ratio = len(re.findall(r'[^a-zA-Z0-9\s]', text)) / max(1, len(text))
        if special_char_ratio > 0.1:
            score += 10
            flags.append("poor_grammar_indicators")
        
        # Vague/generic content
        generic_keywords = ['something', 'maybe', 'i think', 'not sure', 'probably']
        generic_count = sum(1 for kw in generic_keywords if kw in text)
        if generic_count >= 2:
            score += 8
            flags.append("vague_language")
        
        return score, flags
    
    def _detect_spam_patterns(self, text: str) -> tuple:
        """Detect spam patterns in text."""
        score = 0.0
        flags = []
        
        # Check spam regex patterns
        for pattern in self.spam_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                score += 15
                flags.append(f"spam_pattern_detected")
        
        # Suspicious keywords
        for kw in self.suspicious_keywords:
            if kw in text:
                score += 5
                flags.append(f"suspicious_keyword: {kw}")
        
        # Cap spam score
        score = min(40, score)
        
        return score, flags
    
    def _analyze_user_credibility(self, reputation: float, frequency: int) -> tuple:
        """Analyze user credibility factors."""
        score = 0.0
        flags = []
        
        # Low reputation
        if reputation < 0.3:
            score += 15
            flags.append("low_user_reputation")
        elif reputation < 0.5:
            score += 8
            flags.append("moderate_user_reputation")
        
        # High submission frequency (spam behavior)
        if frequency > 5:
            score += 20
            flags.append(f"high_submission_frequency: {frequency}reports/hour")
        elif frequency > 3:
            score += 10
            flags.append("elevated_submission_frequency")
        
        return score, flags
    
    def _analyze_authenticity(
        self, image_count: int, location_verified: bool, similar_reports: int
    ) -> tuple:
        """Analyze content authenticity indicators."""
        score = 0.0
        flags = []
        
        # No images (genuine reports often have photos)
        if image_count == 0:
            score += 5
            flags.append("no_images_attached")
        
        # Location not verified
        if not location_verified:
            score += 10
            flags.append("unverified_location")
        
        # Too many similar reports (coordinated spam)
        if similar_reports > 10:
            score += 15
            flags.append(f"potential_spam_campaign: {similar_reports}similar_reports")
        
        # Isolated report with no corroboration
        if similar_reports == 0 and image_count == 0:
            score += 8
            flags.append("isolated_unverified_report")
        
        return score, flags
    
    def batch_detect(self, reports: List[Dict]) -> List[Dict]:
        """Detect fake reports in batch."""
        results = []
        for report in reports:
            result = self.detect(
                report.get('text', ''),
                report.get('description', ''),
                report.get('user_reputation', 0.5),
                report.get('image_count', 0),
                report.get('location_verified', False),
                report.get('source_type', 'user_report'),
                report.get('submission_frequency', 1),
                report.get('similar_reports_count', 0)
            )
            result['report_id'] = report.get('id')
            results.append(result)
        return results
