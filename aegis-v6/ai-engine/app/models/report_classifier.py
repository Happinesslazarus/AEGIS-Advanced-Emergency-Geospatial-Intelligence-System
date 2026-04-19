"""
Rule-based report category classifier used as a bootstrap fallback before
the ML classifier is trained. Applies keyword matching and regex patterns
to the free-text report description to assign one of 10 incident categories
(flood, fire, road, etc.) and a confidence score.

- Used by ai-engine/app/api/endpoints.py POST /classify endpoint
- Replaced by report_classifier_ml.py once training data is available
- Category labels match server/src/services/incidentTypeService.ts values
"""

from typing import Dict, List, Optional
import re
from loguru import logger
from datetime import datetime

class ReportClassifier:
    """
    Classify disaster reports into hazard types using keyword matching.

    This is the fallback implementation. The production ML version lives in
    report_classifier_ml.py (ReportClassifierTrainable) which uses TF-IDF +
    scikit-learn trained on real report data from the database. This class is
    used when no trained model artifact exists.
    """
    
    def __init__(self):
        self.hazard_keywords = {
            'flood': [
                'flood', 'flooding', 'flooded', 'water level', 'inundation',
                'overflow', 'submerged', 'waterlogged', 'rising water',
                'river burst', 'dam breach', 'flash flood', 'deluge'
            ],
            'drought': [
                'drought', 'dry', 'arid', 'water shortage', 'crop failure',
                'parched', 'desiccated', 'water scarcity', 'low rainfall',
                'reservoir empty', 'well dried', 'famine'
            ],
            'heatwave': [
                'heatwave', 'heat wave', 'extreme heat', 'scorching',
                'heat exhaustion', 'heat stroke', 'high temperature',
                'sweltering', 'unbearable heat', 'record temperature'
            ],
            'wildfire': [
                'wildfire', 'forest fire', 'bushfire', 'fire', 'blaze',
                'smoke', 'burning', 'flames', 'conflagration', 'inferno',
                'fire spread', 'evacuate fire', 'ash falling'
            ],
            'storm': [
                'storm', 'hurricane', 'cyclone', 'tornado', 'typhoon',
                'gale', 'tempest', 'wind damage', 'strong winds', 'gusts'
            ],
            'earthquake': [
                'earthquake', 'tremor', 'seismic', 'quake', 'aftershock',
                'ground shaking', 'fault line', 'magnitude', 'epicenter'
            ],
            'landslide': [
                'landslide', 'mudslide', 'rockfall', 'slope failure',
                'earth movement', 'debris flow', 'avalanche'
            ]
        }
        
        self.severity_indicators = {
            'high': [
                'emergency', 'critical', 'life-threatening', 'catastrophic',
                'severe', 'disaster', 'major', 'widespread', 'devastating'
            ],
            'medium': [
                'significant', 'moderate', 'considerable', 'notable',
                'substantial', 'concerning', 'affecting', 'impacting'
            ],
            'low': [
                'minor', 'small', 'limited', 'isolated', 'localized',
                'minimal', 'slight', 'negligible'
            ]
        }
        
        logger.info("Report classifier initialized")
    
    def classify(self, text: str, description: str = "", location: str = "") -> Dict[str, any]:
        """
        Classify a disaster report into hazard type(s).
        
        Args:
            text: Main report text (title)
            description: Optional detailed description
            location: Optional location context
        
        Returns:
            Classification result with hazard type, confidence, and metadata
        """
        try:
            # Combine all text for analysis
            full_text = f"{text} {description} {location}".lower()
            
            # Score each hazard type
            scores = {}
            for hazard, keywords in self.hazard_keywords.items():
                score = sum(1 for kw in keywords if kw in full_text)
                if score > 0:
                    scores[hazard] = score
            
            # Determine primary hazard
            if not scores:
                primary_hazard = 'unknown'
                confidence = 0.3
                probability = 0.4
            else:
                primary_hazard = max(scores, key=scores.get)
                max_score = scores[primary_hazard]
                total_matches = sum(scores.values())
                
                # Confidence: dominance ratio.  If one hazard captures all keyword
                # hits (max_score == total_matches), confidence trends toward 0.95.
                # If hits are split evenly across hazards, it stays near 0.50.
                confidence = min(0.95, 0.50 + (max_score / (total_matches + 1)) * 0.45)
                # Probability: each additional keyword hit adds 0.10 (capped at 0.90).
                probability = min(0.90, 0.55 + max_score * 0.10)
            
            # Extract severity indicators
            severity_hints = self._extract_severity(full_text)
            
            # Extract impact indicators
            impact = self._extract_impact(full_text)
            
            result = {
                'model_version': 'keyword-v1.0.0',
                'primary_hazard': primary_hazard,
                'probability': probability,
                'confidence': confidence,
                'all_hazards_detected': list(scores.keys()),
                'hazard_scores': scores,
                'severity_hint': severity_hints['severity'],
                'severity_confidence': severity_hints['confidence'],
                'impact_indicators': impact,
                'classified_at': datetime.utcnow().isoformat()
            }
            
            logger.info(f"Report classified: {primary_hazard} (conf={confidence:.2f})")
            
            return result
            
        except Exception as e:
            logger.error(f"Report classification error: {e}")
            return {
                'model_version': 'keyword-v1.0.0',
                'primary_hazard': 'unknown',
                'probability': 0.1,
                'confidence': 0.1,
                'error': str(e)
            }
    
    def _extract_severity(self, text: str) -> Dict[str, any]:
        """Extract severity level from text indicators."""
        severity_scores = {level: 0 for level in ['high', 'medium', 'low']}
        
        for level, indicators in self.severity_indicators.items():
            severity_scores[level] = sum(1 for ind in indicators if ind in text)
        
        total = sum(severity_scores.values())
        if total == 0:
            return {'severity': 'medium', 'confidence': 0.4}
        
        severity = max(severity_scores, key=severity_scores.get)
        confidence = severity_scores[severity] / total if total > 0 else 0.4
        
        # Severity signals are weaker than hazard signals: a threshold cap of
        # 0.85 prevents the rule engine from claiming high certainty about
        # severity when it hasn't been trained on labelled examples.
        return {'severity': severity, 'confidence': min(0.85, 0.40 + confidence * 0.45)}
    
    def _extract_impact(self, text: str) -> Dict[str, bool]:
        """Extract impact indicators from text."""
        return {
            'casualties': any(kw in text for kw in ['death', 'casualty', 'injury', 'victim', 'trapped']),
            'property_damage': any(kw in text for kw in ['damage', 'destroyed', 'collapsed', 'loss']),
            'evacuation': any(kw in text for kw in ['evacuate', 'evacuation', 'displaced', 'shelter']),
            'infrastructure': any(kw in text for kw in ['road', 'bridge', 'power', 'water supply', 'infrastructure']),
            'urgent_response': any(kw in text for kw in ['urgent', 'emergency', 'immediate', 'crisis', 'rescue'])
        }
    
    def batch_classify(self, reports: List[Dict[str, str]]) -> List[Dict[str, any]]:
        """Classify multiple reports in batch."""
        results = []
        for report in reports:
            result = self.classify(
                report.get('text', ''),
                report.get('description', ''),
                report.get('location', '')
            )
            result['report_id'] = report.get('id')
            results.append(result)
        return results
