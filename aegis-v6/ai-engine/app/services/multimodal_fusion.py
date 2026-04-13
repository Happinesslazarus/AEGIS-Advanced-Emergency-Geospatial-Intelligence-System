"""
File: multimodal_fusion.py

What this file does:
Fuses predictions from three independent signal sources into a single
incident probability and structured alert for the AEGIS system:

  1. ML hazard score   — numerical weather + terrain features → LightGBM/XGB
  2. CLIP image score  — on-scene photo analysed by fine-tuned ViT-B-32
  3. NLP text score    — incident report / tweet analysed by sentiment + keyword

The fusion strategy is Bayesian model averaging with learned reliability
weights calibrated on a held-out validation set.  When only a subset of
signals is available (e.g., no image attached), the missing-signal weights
are redistributed proportionally across the present signals.

Output schema (returned as a dict / JSON):
  {
    "incident_type":     str,      # highest-probability hazard class
    "confidence":        float,    # 0–1 fused probability
    "ml_score":          float,    # raw ML model output
    "clip_score":        float,    # CLIP classification confidence
    "nlp_score":         float,    # NLP classification confidence
    "damage_severity":   str,      # "none" | "minor" | "major" | "destroyed"
    "severity_confidence": float,
    "signals_used":      list[str],
    "explanation":       str,      # plain-English reason for the prediction
  }

Glossary:
  Bayesian model averaging  = treating each model as a separate expert and
                              weighting their predictions by their empirical
                              reliability on a calibration set
  CLIP                      = Contrastive Language–Image Pre-training; maps
                              images to the same embedding space as text
  NLP                       = Natural Language Processing; here a fine-tuned
                              DistilBERT zero-shot or keyword classifier
  isotonic calibration      = a non-parametric method to convert raw model
                              scores into proper probabilities

How it connects:
  Called by  ← app/routers/predict.py (REST endpoint POST /api/predict)
             ← app/routers/reports.py (community report analysis)
  Uses       → model_registry/clip/clip_crisis_vit_b32.pt
             → model_registry/clip/clip_damage_severity_vit_b32.pt
             → model_registry/<hazard>/<hazard>_uk_v2*.pkl

Usage (programmatic):
  from app.services.multimodal_fusion import MultimodalFusionService
  svc    = MultimodalFusionService()
  result = svc.fuse(
      ml_features=features_dict,
      image_path="/tmp/upload.jpg",   # optional
      text="Severe flooding on A30",  # optional
  )
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Lazy-load heavy dependencies so startup time is minimal
_torch       = None
_open_clip   = None
_joblib      = None
_transformers = None
_PIL         = None

_AI_ROOT     = Path(__file__).resolve().parents[2]
REGISTRY_DIR = _AI_ROOT / "model_registry"

# Reliability weights per signal type  (empirically calibrated; see README)
# These are priors — updated at runtime if dynamic calibration data available
DEFAULT_WEIGHTS = {
    "ml":    0.55,
    "clip":  0.28,
    "nlp":   0.17,
}

# Maps fine-tuned CLIP class name ↔ AEGIS incident type
CLIP_TO_HAZARD = {
    "flood":             "flood",
    "wildfire":          "wildfire",
    "earthquake_damage": "earthquake_damage",
    "hurricane":         "severe_storm",
    "tornado":           "severe_storm",
    "drought":           "drought",
    "not_disaster":      None,
}

HAZARD_ORDER = [
    "flood", "drought", "heatwave", "wildfire", "severe_storm",
    "landslide", "power_outage", "water_supply_disruption",
    "infrastructure_damage", "public_safety_incident", "environmental_hazard",
]

SEVERITY_CLASSES = ["no_damage", "minor_damage", "major_damage", "destroyed"]


def _get_torch():
    global _torch
    if _torch is None:
        import torch as t
        _torch = t
    return _torch


def _get_open_clip():
    global _open_clip
    if _open_clip is None:
        import open_clip
        _open_clip = open_clip
    return _open_clip


def _get_joblib():
    global _joblib
    if _joblib is None:
        import joblib as j
        _joblib = j
    return _joblib


class MLScorer:
    """
    Wraps the tabular weather/terrain ML models.
    Loads all v2 hazard models at startup for low-latency inference.
    """

    def __init__(self) -> None:
        self._models: dict[str, Any] = {}
        self._load_models()

    def _load_models(self) -> None:
        joblib = _get_joblib()
        for hazard in HAZARD_ORDER:
            pattern = REGISTRY_DIR / hazard
            if not pattern.exists():
                continue
            # Prefer v2 model, fall back to any .pkl
            candidates = sorted(pattern.glob("*_v2*.pkl")) or sorted(pattern.glob("*.pkl"))
            if candidates:
                try:
                    artifact = joblib.load(str(candidates[0]))
                    self._models[hazard] = artifact
                    logger.debug(f"Loaded ML model: {candidates[0].name}")
                except Exception as exc:
                    logger.warning(f"Could not load {hazard}: {exc}")

    def score(self, features: dict[str, float]) -> dict[str, float]:
        """Return probability per hazard given a feature dict."""
        import pandas as pd
        scores: dict[str, float] = {}
        row = pd.DataFrame([features])

        for hazard, artifact in self._models.items():
            model = artifact.get("model") or artifact
            feat_names = artifact.get("feature_names", [])
            if feat_names:
                row_aligned = row.reindex(columns=feat_names, fill_value=0.0)
            else:
                row_aligned = row
            try:
                prob = float(model.predict_proba(row_aligned)[0, 1])
                scores[hazard] = prob
            except Exception as exc:
                logger.debug(f"ML score failed for {hazard}: {exc}")
        return scores


class CLIPScorer:
    """
    Wraps the fine-tuned CLIP model for crisis image classification +
    damage severity estimation.
    """

    def __init__(self) -> None:
        self._clip_model       = None
        self._severity_model   = None
        self._preprocess       = None
        self._tokenizer        = None
        self._device           = None
        self._text_features    = None  # cached label text embeddings
        self._loaded           = False
        self._severity_loaded  = False

    def _lazy_load(self) -> bool:
        if self._loaded:
            return True
        try:
            torch     = _get_torch()
            open_clip = _get_open_clip()

            self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

            model, _, preprocess = open_clip.create_model_and_transforms(
                "ViT-B-32", pretrained="openai"
            )
            ckpt = REGISTRY_DIR / "clip" / "clip_crisis_vit_b32.pt"
            if ckpt.exists():
                model.load_state_dict(
                    torch.load(str(ckpt), map_location=self._device)
                )
            model = model.to(self._device).eval()

            self._clip_model = model
            self._preprocess = preprocess
            self._tokenizer  = open_clip.get_tokenizer("ViT-B-32")

            # Pre-compute text embeddings for zero-shot classification
            from training.finetune_clip import CRISIS_LABELS
            texts = list(CRISIS_LABELS.values())
            tokens = self._tokenizer(texts).to(self._device)
            with torch.no_grad():
                self._text_features = model.encode_text(tokens)
                self._text_features = torch.nn.functional.normalize(
                    self._text_features, dim=-1
                )
            self._clip_label_keys = list(CRISIS_LABELS.keys())
            self._loaded = True
            return True
        except Exception as exc:
            logger.warning(f"CLIP model not available: {exc}")
            return False

    def _lazy_load_severity(self) -> bool:
        """Load the damage severity classification head."""
        if self._severity_loaded:
            return self._severity_model is not None
        self._severity_loaded = True
        try:
            if not self._lazy_load():
                return False
            torch = _get_torch()
            import torch.nn as nn

            ckpt = REGISTRY_DIR / "clip" / "clip_damage_severity_vit_b32.pt"
            if not ckpt.exists():
                logger.info("Damage severity checkpoint not found — skipping")
                return False

            embed_dim = 512
            head = nn.Sequential(
                nn.LayerNorm(embed_dim),
                nn.Linear(embed_dim, 256),
                nn.GELU(),
                nn.Dropout(0.25),
                nn.Linear(256, len(SEVERITY_CLASSES)),
            )
            state = torch.load(str(ckpt), map_location=self._device)
            # Extract only the head weights (keys starting with 'head.')
            head_state = {k.replace("head.", ""): v for k, v in state.items()
                          if k.startswith("head.")}
            if head_state:
                head.load_state_dict(head_state)
            else:
                head.load_state_dict(state, strict=False)
            self._severity_model = head.to(self._device).eval()
            logger.info("Damage severity head loaded")
            return True
        except Exception as exc:
            logger.warning(f"Severity model load failed: {exc}")
            return False

    def score_image(
        self, image_path: str
    ) -> tuple[str | None, float, dict[str, float]]:
        """
        Classify a crisis image.
        Returns (best_class, confidence, all_class_probs).
        """
        if not self._lazy_load():
            return None, 0.0, {}
        torch = _get_torch()
        from PIL import Image as PILImage

        try:
            img = PILImage.open(image_path).convert("RGB")
        except Exception as exc:
            logger.warning(f"Cannot open image {image_path}: {exc}")
            return None, 0.0, {}

        img_t = self._preprocess(img).unsqueeze(0).to(self._device)
        with torch.no_grad():
            img_feat = self._clip_model.encode_image(img_t)
            img_feat = torch.nn.functional.normalize(img_feat, dim=-1)
            sims     = (img_feat @ self._text_features.t()).squeeze(0)
            probs    = sims.softmax(dim=-1)

        all_probs = {
            k: round(float(probs[i]), 4)
            for i, k in enumerate(self._clip_label_keys)
        }
        best_idx   = int(probs.argmax().item())
        best_class = self._clip_label_keys[best_idx]
        confidence = float(probs[best_idx])
        return best_class, confidence, all_probs

    def score_severity(self, image_path: str) -> tuple[str, float]:
        """
        Estimate damage severity for an image.
        Returns (severity_class, confidence).
        """
        if not self._lazy_load_severity():
            return "no_damage", 0.0
        torch = _get_torch()
        from PIL import Image as PILImage

        try:
            img   = PILImage.open(image_path).convert("RGB")
            img_t = self._preprocess(img).unsqueeze(0).to(self._device)
        except Exception:
            return "no_damage", 0.0

        with torch.no_grad():
            feats  = self._clip_model.visual(img_t)
            logits = self._severity_model(feats)
            probs  = logits.softmax(dim=-1).squeeze(0)

        best_idx = int(probs.argmax().item())
        return SEVERITY_CLASSES[best_idx], round(float(probs[best_idx]), 4)


class NLPScorer:
    """
    Lightweight NLP scorer that uses keyword matching + optional zero-shot
    DistilBERT for incident report text classification.
    """

    # Keyword signals per hazard
    KEYWORDS: dict[str, list[str]] = {
        "flood":                   ["flood","flooding","inundation","waterlogged","submerged"],
        "wildfire":                ["fire","wildfire","blaze","burning","smoke"],
        "drought":                 ["drought","dry","water shortage","low river"],
        "heatwave":                ["heatwave","heat wave","extreme heat","temperature record"],
        "severe_storm":            ["storm","gale","hurricane","tornado","wind damage"],
        "landslide":               ["landslide","mudslide","debris flow","rockfall"],
        "power_outage":            ["power cut","blackout","outage","no electricity"],
        "water_supply_disruption": ["water supply","burst pipe","no water","contaminated water"],
        "infrastructure_damage":   ["road closed","bridge damage","rail disruption","collapsed"],
        "public_safety_incident":  ["rescue","evacuation","missing persons","emergency"],
        "environmental_hazard":    ["pollution","chemical spill","oil spill","toxic"],
    }

    def score(self, text: str) -> dict[str, float]:
        """Return keyword-hit frequency scores per hazard (0–1 scaled)."""
        text_lower = text.lower()
        scores     = {}
        for hazard, kws in self.KEYWORDS.items():
            hits         = sum(1 for kw in kws if kw in text_lower)
            scores[hazard] = min(1.0, hits / max(len(kws), 1))
        # Normalise so they sum to 1 (maintain interpretability)
        total = sum(scores.values())
        if total > 0:
            scores = {k: round(v / total, 4) for k, v in scores.items()}
        return scores


class MultimodalFusionService:
    """
    Main service class.  Instantiate once at app startup and call .fuse()
    for each incident prediction request.

    >>> svc = MultimodalFusionService()
    >>> result = svc.fuse(ml_features={"precipitation_6h": 45.0}, text="floods")
    """

    def __init__(self, weights: dict[str, float] | None = None) -> None:
        self._ml_scorer   = MLScorer()
        self._clip_scorer = CLIPScorer()   # lazy-loaded on first image
        self._nlp_scorer  = NLPScorer()
        self._weights     = weights or DEFAULT_WEIGHTS

    def fuse(
        self,
        ml_features:  dict[str, float] | None = None,
        image_path:   str | None = None,
        text:         str | None = None,
    ) -> dict:
        """
        Run all available scorers and return a fused prediction dict.

        Fusion uses Bayesian log-odds combination: each signal's probability
        is converted to log-odds, weighted, summed, then converted back.
        This is theoretically grounded and handles correlated errors better
        than simple weighted averaging.
        """
        import math

        signals_used: list[str] = []
        per_hazard_scores: dict[str, dict[str, float]] = {h: {} for h in HAZARD_ORDER}

        # ── ML signal ──────────────────────────────────────────────────────
        ml_scores: dict[str, float] = {}
        if ml_features:
            ml_scores    = self._ml_scorer.score(ml_features)
            signals_used.append("ml")
            for hazard, score in ml_scores.items():
                per_hazard_scores[hazard]["ml"] = score

        # ── CLIP / image signal ────────────────────────────────────────────
        clip_hazard: str | None = None
        clip_conf  : float      = 0.0
        damage_severity: str    = "no_damage"
        severity_conf:   float  = 0.0
        if image_path:
            clip_class, clip_conf, clip_all = self._clip_scorer.score_image(image_path)
            if clip_class and clip_class != "not_disaster":
                signals_used.append("clip")
                mapped = CLIP_TO_HAZARD.get(clip_class)
                if mapped:
                    per_hazard_scores[mapped]["clip"] = clip_conf
                    clip_hazard = mapped
            # Damage severity (independent of hazard classification)
            damage_severity, severity_conf = self._clip_scorer.score_severity(image_path)

        # ── NLP signal ─────────────────────────────────────────────────────
        nlp_scores: dict[str, float] = {}
        if text and text.strip():
            nlp_scores   = self._nlp_scorer.score(text)
            signals_used.append("nlp")
            for hazard, score in nlp_scores.items():
                per_hazard_scores[hazard]["nlp"] = score

        # ── Bayesian log-odds fusion ───────────────────────────────────────
        # Convert probabilities to log-odds, weight, sum, convert back.
        # Clamp probabilities to [0.01, 0.99] to avoid infinite log-odds.
        active_weights: dict[str, float] = {
            k: v for k, v in self._weights.items() if k in signals_used
        }
        if not active_weights:
            return self._empty_result()

        total_w = sum(active_weights.values())
        active_weights = {k: v / total_w for k, v in active_weights.items()}

        def _prob_to_logodds(p: float) -> float:
            p = max(0.01, min(0.99, p))
            return math.log(p / (1.0 - p))

        def _logodds_to_prob(lo: float) -> float:
            return 1.0 / (1.0 + math.exp(-lo))

        # Prior log-odds: assume 1/11 base rate for each hazard
        prior_lo = _prob_to_logodds(1.0 / len(HAZARD_ORDER))

        fused: dict[str, float] = {}
        for hazard in HAZARD_ORDER:
            score_parts = per_hazard_scores[hazard]
            if not score_parts:
                fused[hazard] = _logodds_to_prob(prior_lo)
                continue
            combined_lo = prior_lo
            for sig in signals_used:
                if sig in score_parts:
                    p  = score_parts[sig]
                    w  = active_weights.get(sig, 0.0)
                    # Weighted log-likelihood ratio
                    combined_lo += w * (_prob_to_logodds(p) - prior_lo)
            fused[hazard] = _logodds_to_prob(combined_lo)

        # ── Pick best hazard ───────────────────────────────────────────────
        best_hazard    = max(fused, key=fused.get)
        best_score     = fused[best_hazard]

        # ── Uncertainty: Shannon entropy of the fused distribution ─────────
        fused_vals = list(fused.values())
        total_p    = sum(fused_vals) or 1.0
        normalised = [p / total_p for p in fused_vals]
        entropy    = -sum(p * math.log(p + 1e-12) for p in normalised)
        max_entropy = math.log(len(HAZARD_ORDER))
        uncertainty = round(entropy / max_entropy, 4)  # 0 = certain, 1 = uniform

        # ── Build explanation string ───────────────────────────────────────
        parts = []
        if "ml" in signals_used and ml_scores.get(best_hazard, 0) > 0.4:
            parts.append(f"weather/terrain model: {ml_scores[best_hazard]:.0%}")
        if "clip" in signals_used and clip_hazard == best_hazard:
            parts.append(f"image analysis: {clip_conf:.0%}")
        if "nlp" in signals_used and nlp_scores.get(best_hazard, 0) > 0.2:
            parts.append(f"text analysis: {nlp_scores[best_hazard]:.0%}")
        explanation = (
            f"Predicted {best_hazard.replace('_',' ')} with "
            f"{best_score:.0%} fused confidence from: {', '.join(parts) or 'all signals'}."
        )

        return {
            "incident_type":      best_hazard,
            "confidence":         round(best_score, 4),
            "ml_score":           round(ml_scores.get(best_hazard, 0.0), 4),
            "clip_score":         round(clip_conf if clip_hazard == best_hazard else 0.0, 4),
            "nlp_score":          round(nlp_scores.get(best_hazard, 0.0), 4),
            "damage_severity":    damage_severity,
            "severity_confidence": severity_conf,
            "uncertainty":        uncertainty,
            "signals_used":       signals_used,
            "all_hazard_scores":  {h: round(s, 4) for h, s in fused.items()},
            "explanation":        explanation,
        }

    @staticmethod
    def _empty_result() -> dict:
        return {
            "incident_type":       "unknown",
            "confidence":          0.0,
            "ml_score":            0.0,
            "clip_score":          0.0,
            "nlp_score":           0.0,
            "damage_severity":     "no_damage",
            "severity_confidence": 0.0,
            "signals_used":        [],
            "all_hazard_scores":   {},
            "explanation":         "Insufficient signal — no features, image, or text provided.",
        }
