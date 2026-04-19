"""
Image classification model (analyses disaster photos).
"""

from typing import Dict, Any
import numpy as np
from PIL import Image
from io import BytesIO
from loguru import logger
from datetime import datetime

import torch
import open_clip

from app.schemas.predictions import HazardType, RiskLevel

# CLIP text prompts engineered for disaster classification (prompt ensembling)
PROMPT_TEMPLATES = {
    "wildfire": [
        "a photo of active flames and fire burning trees and vegetation",
        "a photo of a wildfire with visible orange flames and thick smoke",
        "a photo of a forest engulfed in fire with smoke rising",
        "a photo of burning hillside with fire and glowing embers",
        "aerial view of an active wildfire spreading through a landscape",
    ],
    "flood": [
        "a photo of deep brown murky water covering streets from flooding",
        "a photo of buildings partially submerged in flood water",
        "a photo of cars and vehicles submerged in rising flood water",
        "a photo of an overflowing river flooding the surrounding area",
        "a photo of a flooded residential neighborhood with water everywhere",
    ],
    "earthquake": [
        "a photo of collapsed concrete buildings from an earthquake",
        "a photo of pancaked floors and rubble from seismic destruction",
        "a photo of cracked walls and tilted buildings after an earthquake",
        "a photo of earthquake rubble with rebar and broken concrete",
        "a photo of a destroyed city block after a major earthquake",
    ],
    "storm": [
        "a photo of a severe thunderstorm with dark ominous clouds",
        "a photo of lightning striking during a violent storm",
        "a photo of a tornado funnel cloud touching the ground",
        "a photo of hurricane wind damage with uprooted trees",
        "a photo of dark storm clouds and heavy rain",
    ],
    "landslide": [
        "a photo of a mudslide with earth and rocks sliding down a hill",
        "a photo of a landslide blocking a road with displaced soil",
        "a photo of a collapsed hillside with exposed brown earth",
        "a photo of debris flow of mud and rocks down a mountainside",
        "a photo of terrain failure with soil and vegetation sliding downhill",
    ],
    "drought": [
        "a photo of severely cracked dry earth with deep fissures from drought",
        "a photo of a dried up empty riverbed or lake bed",
        "a photo of dead brown crops on a barren farm from drought",
        "a photo of dry barren terrain with no water and no green vegetation",
        "a photo of cracked dried mud flats from prolonged water shortage",
    ],
    "structural_damage": [
        "a photo of a partially collapsed building with broken walls",
        "a photo of a damaged bridge or overpass that has failed",
        "a photo of building rubble with exposed steel and broken concrete",
        "a photo of a roof caved in on a damaged house or structure",
        "a photo of structural failure with leaning walls and debris",
    ],
    "heatwave": [
        "a photo of visible heat shimmer and haze rising from hot pavement",
        "a photo of harsh glaring sun over a heat-scorched landscape",
        "a photo of heat distortion waves in the air over a road",
        "a photo of a sun-bleached landscape with intense bright sunlight",
        "a photo of shimmering heat haze over dry hot terrain",
    ],
    "safe": [
        "a photo of a beautiful normal day with clear blue sky and green trees",
        "a photo of a clean well-maintained city street with no damage",
        "a photo of intact buildings and a peaceful residential neighborhood",
        "a photo of a calm lake or river with undamaged scenery",
        "a photo of people in a normal everyday outdoor setting with no hazards",
    ],
}

CATEGORIES = list(PROMPT_TEMPLATES.keys())

SEVERITY_MAP = {
    "critical": 0.45,
    "high": 0.30,
    "moderate": 0.20,
    "low": 0.10,
}

class ImageClassifier:
    """
    Disaster image classification using CLIP ViT-B-32 zero-shot inference.
    52.4% accuracy on AEGIS 42-image benchmark (vs 40.5% with Ollama gemma3:4b).
    Average inference: ~37ms on GPU, ~200ms on CPU.
    """

    def __init__(self):
        self.model = None
        self.preprocess = None
        self.tokenizer = None
        self.device = None
        self.text_embeddings = None
        self.class_labels = CATEGORIES
        self._loaded = False
        logger.info("ImageClassifier initialized (CLIP ViT-B-32, lazy load)")

    def _ensure_loaded(self):
        """Lazy-load CLIP model on first use."""
        if self._loaded:
            return
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Loading CLIP ViT-B-32 on {self.device}...")
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="openai", device=self.device
        )
        self.tokenizer = open_clip.get_tokenizer("ViT-B-32")
        self.model.eval()
        self._build_text_embeddings()
        self._loaded = True
        logger.info("CLIP model loaded and text embeddings cached")

    def _build_text_embeddings(self):
        """Pre-compute averaged text embeddings for each category."""
        self.text_embeddings = {}
        with torch.no_grad():
            for category, prompts in PROMPT_TEMPLATES.items():
                tokens = self.tokenizer(prompts).to(self.device)
                features = self.model.encode_text(tokens)
                features /= features.norm(dim=-1, keepdim=True)
                avg = features.mean(dim=0)
                avg /= avg.norm()
                self.text_embeddings[category] = avg

    async def classify(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Classify disaster image using CLIP zero-shot inference.

        Args:
            image_bytes: Raw image bytes (JPEG/PNG)

        Returns:
            Classification result with hazard type, probabilities, severity
        """
        try:
            self._ensure_loaded()
            t_start = datetime.utcnow()

            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            img_tensor = self.preprocess(image).unsqueeze(0).to(self.device)

            with torch.no_grad():
                image_features = self.model.encode_image(img_tensor)
                image_features /= image_features.norm(dim=-1, keepdim=True)

            # Compute cosine similarity with each category
            similarities = {}
            for category, text_emb in self.text_embeddings.items():
                sim = (image_features @ text_emb.unsqueeze(1)).squeeze().item()
                similarities[category] = sim

            # Temperature-scaled softmax
            temperature = 0.01
            sim_values = np.array([similarities[c] for c in CATEGORIES])
            exp_vals = np.exp((sim_values - sim_values.max()) / temperature)
            probabilities = exp_vals / exp_vals.sum()

            prob_dict = {c: float(probabilities[i]) for i, c in enumerate(CATEGORIES)}
            pred_idx = int(probabilities.argmax())
            hazard_type = CATEGORIES[pred_idx]
            confidence = float(probabilities[pred_idx])

            # Map confidence to severity
            severity = "none"
            for level, threshold in SEVERITY_MAP.items():
                if confidence >= threshold:
                    severity = level
                    break

            # Map to AEGIS hazard type naming
            mapped_type = "normal" if hazard_type == "safe" else hazard_type

            elapsed_ms = (datetime.utcnow() - t_start).total_seconds() * 1000

            result = {
                "model_version": "clip-vit-b-32-v1.0",
                "hazard_type": mapped_type,
                "disaster_type": hazard_type,
                "probability": confidence,
                "risk_level": severity,
                "confidence": confidence,
                "probabilities": prob_dict,
                "image_size": f"{image.width}x{image.height}",
                "processing_time_ms": round(elapsed_ms, 1),
                "device": self.device,
                "classified_at": datetime.utcnow().isoformat(),
            }

            logger.info(
                f"CLIP classified: {hazard_type} ({confidence*100:.1f}%) "
                f"severity={severity} in {elapsed_ms:.0f}ms"
            )
            return result

        except Exception as e:
            logger.error(f"Image classification error: {e}")
            return {
                "model_version": "clip-vit-b-32-v1.0",
                "hazard_type": "unknown",
                "probability": 0.0,
                "risk_level": "low",
                "confidence": 0.0,
                "error": str(e),
            }

    def get_class_probabilities(self, image_bytes: bytes) -> Dict[str, float]:
        """Return probability distribution across all hazard classes synchronously."""
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(self.classify(image_bytes))
        return result.get("probabilities", {c: 0.0 for c in CATEGORIES})
