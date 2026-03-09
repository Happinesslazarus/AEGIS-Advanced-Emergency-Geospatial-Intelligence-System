"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Image Classification Module
 CNN-based disaster image recognition
═══════════════════════════════════════════════════════════════════════════════
"""

from typing import Dict, Optional, Any
import numpy as np
from PIL import Image
from io import BytesIO
from loguru import logger
from datetime import datetime

from app.schemas.predictions import HazardType, RiskLevel


class ImageClassifier:
    """
    Disaster image classification using computer vision.
    
    In production, this would use:
    - ResNet50/EfficientNet pre-trained on ImageNet
    - Fine-tuned on disaster image datasets (e.g., AIDER, DisasterNet)
    - Multi-label classification for hazard types
    
    Current implementation: Heuristic-based stub for rapid prototyping
    """
    
    def __init__(self):
        self.model = None
        self.class_labels = [
            'flood', 'drought', 'heatwave', 'wildfire',
            'storm', 'earthquake', 'landslide', 'normal'
        ]
        logger.info("Image classifier initialized (stub mode)")
    
    async def classify(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Classify disaster image and return hazard type prediction.
        
        Args:
            image_bytes: Raw image bytes (JPEG/PNG)
        
        Returns:
            Classification result with hazard type, probability, confidence
        """
        try:
            # Load image
            image = Image.open(BytesIO(image_bytes))
            
            # Handle RGBA images (convert to RGB)
            if image.mode == 'RGBA':
                image = image.convert('RGB')
            
            # Resize for model input (standard 224x224 for most CNNs)
            image = image.resize((224, 224))
            
            # Convert to numpy array
            img_array = np.array(image) / 255.0
            
            # Stub prediction logic
            # In production: model.predict(img_array)
            result = self._stub_classify(img_array, image)
            
            logger.info(f"Image classified: {result['hazard_type']} (prob={result['probability']:.2f})")
            
            return result
            
        except Exception as e:
            logger.error(f"Image classification error: {e}")
            return {
                'model_version': 'stub-v1.0.0',
                'hazard_type': 'unknown',
                'probability': 0.0,
                'risk_level': 'low',
                'confidence': 0.0,
                'error': str(e)
            }
    
    def _stub_classify(self, img_array: np.ndarray, image: Image.Image) -> Dict[str, Any]:
        """
        Stub classification using simple heuristics.
        Analyzes color distribution and brightness as proxy for hazard type.
        """
        # Calculate color statistics
        mean_rgb = img_array.mean(axis=(0, 1))
        std_rgb = img_array.std(axis=(0, 1))
        brightness = mean_rgb.mean()
        
        # Blue channel dominance → flood
        if mean_rgb[2] > mean_rgb[0] * 1.2 and mean_rgb[2] > mean_rgb[1] * 1.1:
            hazard_type = 'flood'
            probability = 0.65 + (mean_rgb[2] - mean_rgb[0]) * 0.2
            risk_level = 'high' if probability > 0.75 else 'medium'
        
        # Red/orange dominance → wildfire or heatwave
        elif mean_rgb[0] > mean_rgb[2] * 1.15 and brightness > 0.4:
            if mean_rgb[0] > 0.6 and mean_rgb[1] < 0.4:
                hazard_type = 'wildfire'
                probability = 0.60 + mean_rgb[0] * 0.15
            else:
                hazard_type = 'heatwave'
                probability = 0.55 + brightness * 0.2
            risk_level = 'medium'
        
        # Low brightness + brown tones → drought
        elif brightness < 0.35 and mean_rgb[0] > mean_rgb[2]:
            hazard_type = 'drought'
            probability = 0.58 + (0.4 - brightness) * 0.3
            risk_level = 'medium'
        
        # High variance → storm/turbulence
        elif std_rgb.mean() > 0.15:
            hazard_type = 'storm'
            probability = 0.62 + std_rgb.mean() * 0.2
            risk_level = 'medium'
        
        # Default: normal conditions
        else:
            hazard_type = 'normal'
            probability = 0.70
            risk_level = 'low'
        
        # Ensure probability bounds
        probability = np.clip(probability, 0.0, 1.0)
        
        # Confidence inversely proportional to ambiguity
        confidence = 0.60 + (probability - 0.5) * 0.4
        confidence = np.clip(confidence, 0.4, 0.85)
        
        return {
            'model_version': 'stub-v1.0.0',
            'hazard_type': hazard_type,
            'probability': float(probability),
            'risk_level': risk_level,
            'confidence': float(confidence),
            'image_size': f"{image.width}x{image.height}",
            'classified_at': datetime.utcnow().isoformat()
        }
    
    def load_model(self, model_path: str):
        """Load pre-trained CNN model (production use)."""
        # TODO: Implement model loading with torch/tensorflow
        # self.model = torch.load(model_path)
        # self.model.eval()
        logger.warning("load_model() not implemented - using stub")
    
    def get_class_probabilities(self, img_array: np.ndarray) -> Dict[str, float]:
        """Return probability distribution across all hazard classes."""
        # TODO: Implement with real model
        # return {label: prob for label, prob in zip(self.class_labels, predictions)}
        return {label: 0.1 for label in self.class_labels}
