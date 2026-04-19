"""
Rule-based severity predictor used as a bootstrap fallback. Combines
keyword signals, numeric counts (trapped_persons, injuries), and report
context to produce a severity score (low / medium / high / critical)
and estimated affected population.

- Used by ai-engine/app/api/endpoints.py POST /severity endpoint
- Replaced by severity_predictor_ml.py once sufficient training data exists
- Severity maps to database severity column (server/sql/schema.sql)
"""

import os
import json
import pickle
from typing import Dict, Optional, List, Tuple, Any
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from loguru import logger

# Optional heavy imports — guarded for startup speed: xgboost and shap add ~2s
# to import time and are only needed when a trained model is actually present.
_xgb = None
_tfidf = None
_shap = None

def _lazy_imports():
    """Lazy-load heavy ML libraries on first use."""
    global _xgb, _tfidf, _shap
    if _xgb is None:
        try:
            import xgboost as xgb_mod
            _xgb = xgb_mod
        except ImportError:
            logger.warning("xgboost not available — falling back to sklearn")
    if _tfidf is None:
        from sklearn.feature_extraction.text import TfidfVectorizer
        _tfidf = TfidfVectorizer
    if _shap is None:
        try:
            import shap as shap_mod
            _shap = shap_mod
        except ImportError:
            pass

# CONSTANTS

MODEL_DIR = Path(__file__).parent.parent.parent / "model_registry" / "severity"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

SEVERITY_CLASSES = ['low', 'medium', 'high', 'critical']
SEVERITY_MAP = {label: idx for idx, label in enumerate(SEVERITY_CLASSES)}
MIN_TRAINING_SAMPLES = 50
MIN_SAMPLES_PER_CLASS = 5

# ML SEVERITY PREDICTOR

class SeverityPredictor:
    """
    ML-based severity predictor using XGBoost + TF-IDF.
    Falls back to heuristic only when no trained model is available.
    """

    def __init__(self):
        _lazy_imports()
        self.model = None
        self.vectorizer = None
        self.char_vectorizer = None
        self.scaler = None
        self.feature_names: List[str] = []
        self.model_version = 'ml-v4.0.0'
        self.training_metrics: Dict[str, Any] = {}
        self._load_model()
        logger.info(f"Severity predictor initialized: {self.model_version}")

    def _model_path(self) -> Path:
        return MODEL_DIR / "severity_xgb_model.pkl"

    def _vectorizer_path(self) -> Path:
        return MODEL_DIR / "severity_tfidf.pkl"

    def _metrics_path(self) -> Path:
        return MODEL_DIR / "severity_metrics.json"

    def _load_model(self):
        """Load trained model from disk if available."""
        model_path = self._model_path()
        vec_path = self._vectorizer_path()
        char_vec_path = MODEL_DIR / "severity_char_tfidf.pkl"
        scaler_path = MODEL_DIR / "severity_scaler.pkl"
        metrics_path = self._metrics_path()

        if model_path.exists() and vec_path.exists():
            try:
                with open(model_path, 'rb') as f:
                    self.model = pickle.load(f)
                with open(vec_path, 'rb') as f:
                    self.vectorizer = pickle.load(f)
                if char_vec_path.exists():
                    with open(char_vec_path, 'rb') as f:
                        self.char_vectorizer = pickle.load(f)
                if scaler_path.exists():
                    with open(scaler_path, 'rb') as f:
                        self.scaler = pickle.load(f)
                if metrics_path.exists():
                    with open(metrics_path, 'r') as f:
                        self.training_metrics = json.load(f)
                self.model_version = self.training_metrics.get('model_version', 'ml-v4.0.0')
                logger.info(f"Loaded severity model: {self.model_version}, "
                            f"accuracy={self.training_metrics.get('accuracy', 'N/A')}")
            except Exception as e:
                logger.error(f"Failed to load severity model: {e}")
                self.model = None
                self.vectorizer = None
        else:
            logger.info("No trained severity model found — using heuristic fallback")
            self.model_version = 'heuristic-v3.0.0'

    @staticmethod
    def _engineer_numeric_features(full_text: str, hazard_type: str = "",
                                   incident_category: str = "") -> np.ndarray:
        """
        Engineer 40+ numeric features from text and metadata.
        v4.0: Enhanced with weighted keyword scores, numeric entity extraction,
        action verb density, negation detection, and severity-discriminative ratios.
        """
        import re
        words = full_text.split()
        word_count = len(words)
        text_len = len(full_text)
        text_lower = full_text.lower()

        # Text complexity features
        avg_word_len = np.mean([len(w) for w in words]) if words else 0
        unique_ratio = len(set(w.lower() for w in words)) / max(1, word_count)
        sentence_count = max(1, len(re.split(r'[.!?]+', full_text)))
        avg_sentence_len = word_count / sentence_count

        # WEIGHTED urgency keyword scoring (v4: weights matter)
        critical_kw = {
            'catastrophic': 5, 'devastating': 5, 'life-threatening': 5,
            'mass casualty': 6, 'multiple fatalities': 6, 'fatalities confirmed': 6,
            'dam breach': 5, 'bridge collapse': 5, 'structural collapse': 5,
            'fatalities': 4, 'emergency declared': 4, 'air ambulance': 4,
            'military deployed': 4, 'mass evacuation': 5, 'catastrophic failure': 5,
            'multiple casualties': 5, 'explosion': 4, 'toxic plume': 4,
            'mass casualty incident': 6, 'life-threatening conditions': 5,
            'overwhelmed': 3, 'out of control': 4, 'imminent': 4,
        }
        high_kw = {
            'severe': 3, 'extensive': 3, 'dangerous': 3, 'urgent': 3,
            'evacuated': 3, 'submerged': 3, 'destroyed': 3, 'trapped': 3,
            'rising rapidly': 3, 'overwhelmed': 2, 'burst': 3,
            'collapsed': 3, 'widespread': 3, 'significant damage': 3,
            'structural damage': 3, 'major disruption': 3, 'rescue operations': 3,
            'emergency services': 2, 'casualties': 3, 'hospitalised': 3,
            'road closure': 2, 'power outage': 2, 'homes evacuated': 3,
            'properties flooded': 3, 'rising water': 2, 'worsening': 2,
        }
        medium_kw = {
            'moderate': 2, 'considerable': 2, 'affecting': 1, 'waterlogged': 2,
            'disruption': 2, 'closed': 1, 'suspended': 2, 'warning': 1,
            'monitoring': 1, 'advisory': 1, 'some damage': 2, 'localised': 1,
            'precautionary': 1, 'sandbags': 1, 'standing water': 1,
            'road partially': 1, 'temporary closure': 2, 'delays': 1,
        }
        low_kw = {
            'minor': 3, 'small': 2, 'limited': 2, 'isolated': 2, 'slight': 3,
            'negligible': 4, 'precaution': 2, 'no damage': 4, 'self-draining': 3,
            'no concern': 4, 'no risk': 4, 'routine': 3, 'no action': 4,
            'no emergency': 4, 'normal': 2, 'cosmetic': 3, 'trivial': 3,
            'not an emergency': 4, 'no safety concern': 4, 'no disruption': 3,
            'no action required': 4, 'no action needed': 4, 'negligible impact': 4,
        }

        critical_score = sum(w for kw, w in critical_kw.items() if kw in text_lower)
        high_score = sum(w for kw, w in high_kw.items() if kw in text_lower)
        medium_score = sum(w for kw, w in medium_kw.items() if kw in text_lower)
        low_score = sum(w for kw, w in low_kw.items() if kw in text_lower)

        # Keyword counts (binary hit)
        critical_count = sum(1 for kw in critical_kw if kw in text_lower)
        high_count = sum(1 for kw in high_kw if kw in text_lower)
        medium_count = sum(1 for kw in medium_kw if kw in text_lower)
        low_count = sum(1 for kw in low_kw if kw in text_lower)

        # Severity-discriminative ratios (v4: key for medium/high separation)
        total_score = critical_score + high_score + medium_score + low_score + 1e-6
        critical_ratio = critical_score / total_score
        high_ratio = high_score / total_score
        medium_ratio = medium_score / total_score
        low_ratio = low_score / total_score

        # Combined urgency score (weighted, normalized)
        urgency_score = min(1.0, (critical_score * 3 + high_score * 1.5 + medium_score * 0.5) / max(1, word_count) * 5)

        # Numeric entity extraction (v4: extract actual numbers for scale)
        numbers = [int(n) for n in re.findall(r'\b(\d{1,6})\b', full_text)]
        max_number = max(numbers) if numbers else 0
        sum_numbers = sum(numbers) if numbers else 0
        number_count = len(numbers)
        has_large_number = 1.0 if any(n >= 100 for n in numbers) else 0.0

        # Action verb density (v4: emergency actions indicate severity)
        action_verbs = ['deploy', 'deployed', 'evacuate', 'evacuated', 'rescue', 'rescued',
                        'collapse', 'collapsed', 'destroy', 'destroyed', 'engulf', 'engulfed',
                        'overwhelm', 'overwhelmed', 'breach', 'breached', 'burst', 'swept']
        action_count = sum(1 for v in action_verbs if v in text_lower)

        # Negation detection (v4: "no damage", "no risk" = low severity)
        negation_patterns = ['no damage', 'no risk', 'no concern', 'no emergency',
                             'no action', 'no disruption', 'no safety', 'not an emergency',
                             'no threat', 'not affected', 'no injuries', 'not dangerous']
        negation_count = sum(1 for p in negation_patterns if p in text_lower)

        # Infrastructure / casualty signals
        infra_words = ['road', 'bridge', 'power', 'hospital', 'school', 'railway', 'airport',
                       'dam', 'water supply', 'gas', 'electricity', 'communication']
        casualty_words = ['death', 'injury', 'casualty', 'victim', 'trapped', 'missing',
                          'rescue', 'ambulance', 'hospital', 'fatality', 'fatalities']
        infra_count = sum(1 for w in infra_words if w in text_lower)
        casualty_count = sum(1 for w in casualty_words if w in text_lower)

        # Category encoding (one-hot style)
        categories = ['natural_disaster', 'infrastructure', 'public_safety',
                      'environmental', 'community_safety', 'medical']
        cat_features = [1.0 if incident_category == c else 0.0 for c in categories]

        # Hazard type encoding
        hazards = ['flood', 'storm', 'wildfire', 'heatwave', 'drought', 'landslide']
        htype = hazard_type.lower() if hazard_type else ''
        hazard_features = [1.0 if htype == h or h in text_lower else 0.0 for h in hazards]

        # Exclamation / caps (urgency proxy)
        exclamation_count = full_text.count('!')
        caps_ratio = sum(1 for c in full_text if c.isupper()) / max(1, text_len)

        return np.array([
            text_len, word_count, avg_word_len, unique_ratio,
            sentence_count, avg_sentence_len,
            critical_count, high_count, medium_count, low_count,
            critical_score, high_score, medium_score, low_score,  # v4: weighted scores
            critical_ratio, high_ratio, medium_ratio, low_ratio,  # v4: score ratios
            urgency_score,
            infra_count, casualty_count,
            action_count,                                         # v4: action verbs
            negation_count,                                       # v4: negation
            max_number, sum_numbers, has_large_number,            # v4: numeric scale
            exclamation_count, caps_ratio, number_count,
            *cat_features,     # 6 features
            *hazard_features,  # 6 features
        ], dtype=np.float32)

    def _build_features(self, text: str, description: str = "",
                        trapped_persons: int = 0, affected_area_km2: float = 0,
                        population_affected: int = 0, hazard_type: str = "",
                        weather_conditions: Optional[Dict] = None) -> np.ndarray:
        """Build feature vector from inputs — must match training feature layout.
        
        Feature layout (order matters — must mirror `_train_async`):
          [0 : N_word)      — word TF-IDF (1200 features)
          [N_word : N_char) — char n-gram TF-IDF (300 features)
          [N_char : end)    — engineered numeric (41 features)
        """
        full_text = f"{text} {description}"

        # TF-IDF word features
        if self.vectorizer:
            text_features = self.vectorizer.transform([full_text]).toarray()[0]
        else:
            text_features = np.zeros(1200)

        # TF-IDF char features
        if self.char_vectorizer:
            char_features = self.char_vectorizer.transform([full_text]).toarray()[0]
        else:
            char_features = np.zeros(300)

        # Engineered numeric features (41 features)
        numeric = self._engineer_numeric_features(full_text, hazard_type)
        if self.scaler:
            numeric = self.scaler.transform(numeric.reshape(1, -1))[0]

        return np.concatenate([text_features, char_features, numeric])

    def predict(
        self,
        text: str,
        description: str = "",
        trapped_persons: int = 0,
        affected_area_km2: float = 0,
        population_affected: int = 0,
        hazard_type: Optional[str] = None,
        weather_conditions: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Predict severity using trained model or heuristic fallback.
        """
        try:
            if self.model is not None and self.vectorizer is not None:
                return self._predict_ml(
                    text, description, trapped_persons, affected_area_km2,
                    population_affected, hazard_type or '', weather_conditions
                )
            else:
                return self._predict_heuristic(
                    text, description, trapped_persons, affected_area_km2,
                    population_affected, hazard_type or '', weather_conditions
                )
        except Exception as e:
            logger.error(f"Severity prediction error: {e}")
            return {
                'model_version': self.model_version,
                'severity': 'medium',
                'probability': 0.5,
                'confidence': 0.3,
                'error': str(e),
                'predicted_at': datetime.utcnow().isoformat()
            }

    def _predict_ml(self, text, description, trapped, area, population,
                    hazard_type, weather) -> Dict[str, Any]:
        """ML-based prediction using trained XGBoost model."""
        features = self._build_features(
            text, description, trapped, area, population, hazard_type, weather
        )
        features_2d = features.reshape(1, -1)

        # Predict class probabilities
        if _xgb and hasattr(self.model, 'predict_proba'):
            probas = self.model.predict_proba(features_2d)[0]
            pred_idx = int(np.argmax(probas))
        else:
            pred_idx = int(self.model.predict(features_2d)[0])
            probas = np.zeros(len(SEVERITY_CLASSES))
            probas[pred_idx] = 0.8

        severity = SEVERITY_CLASSES[pred_idx]
        probability = float(probas[pred_idx])
        confidence = float(np.max(probas))

        # SHAP explanation (if available)
        # TreeExplainer is used instead of the generic KernelExplainer because
        # XGBoost tree structures allow exact SHAP values in O(TLD) time.
        # `shap_values` is a list (one array per class) for multi-class XGBoost;
        # for binary models or DMatrix it may be a plain ndarray — handled below.
        contributing_factors = []
        if _shap and self.model is not None:
            try:
                explainer = _shap.TreeExplainer(self.model)
                shap_values = explainer.shap_values(features_2d)
                if isinstance(shap_values, list):
                    shap_for_pred = shap_values[pred_idx][0]
                else:
                    shap_for_pred = shap_values[0]

                top_indices = np.argsort(np.abs(shap_for_pred))[-5:][::-1]
                for idx in top_indices:
                    if idx < len(self.feature_names):
                        contributing_factors.append(
                            f"{self.feature_names[idx]}: SHAP={shap_for_pred[idx]:.3f}"
                        )
                    else:
                        contributing_factors.append(
                            f"feature_{idx}: SHAP={shap_for_pred[idx]:.3f}"
                        )
            except Exception as e:
                contributing_factors.append(f"SHAP unavailable: {e}")

        return {
            'model_version': self.model_version,
            'severity': severity,
            'probability': probability,
            'confidence': confidence,
            'class_probabilities': {
                SEVERITY_CLASSES[i]: float(probas[i])
                for i in range(len(probas))
            },
            'contributing_factors': contributing_factors,
            'predicted_at': datetime.utcnow().isoformat()
        }

    def _predict_heuristic(self, text, description, trapped, area,
                           population, hazard_type, weather) -> Dict[str, Any]:
        """
        Improved heuristic fallback — used ONLY when no trained model exists.
        """
        full_text = f"{text} {description}".lower()
        score = 0.0
        factors = []

        critical_kw = {
            'catastrophic': 20, 'devastating': 18, 'life-threatening': 20,
            'mass casualty': 25, 'widespread destruction': 22, 'dam breach': 25,
            'bridge collapse': 20, 'multiple deaths': 25, 'rescue operations': 15,
        }
        high_kw = {
            'severe': 12, 'extensive damage': 14, 'significant': 10,
            'dangerous': 12, 'urgent': 10, 'evacuated': 14, 'submerged': 12,
            'destroyed': 14, 'trapped': 15, 'rising rapidly': 12,
        }
        medium_kw = {
            'moderate': 6, 'notable': 5, 'considerable': 6, 'affecting': 5,
            'waterlogged': 5, 'disruption': 5, 'closed road': 6,
        }

        for kw, weight in critical_kw.items():
            if kw in full_text:
                score += weight
                factors.append(f"critical_keyword:{kw}")
        for kw, weight in high_kw.items():
            if kw in full_text:
                score += weight
                factors.append(f"high_keyword:{kw}")
        for kw, weight in medium_kw.items():
            if kw in full_text:
                score += weight
                factors.append(f"medium_keyword:{kw}")

        if trapped > 0:
            score += min(30, trapped * 3)
            factors.append(f"trapped_persons:{trapped}")
        if area > 0:
            score += min(20, area * 0.8)
            factors.append(f"area_km2:{area:.1f}")
        if population > 0:
            score += min(25, population / 80)
            factors.append(f"population:{population}")

        if weather:
            if weather.get('precipitation', 0) > 50:
                score += 8
                factors.append("heavy_precipitation")
            if weather.get('wind_speed', 0) > 25:
                score += 5
                factors.append("high_wind")

        probability = min(1.0, score / 100)

        if probability >= 0.75:
            severity = 'critical'
        elif probability >= 0.50:
            severity = 'high'
        elif probability >= 0.25:
            severity = 'medium'
        else:
            severity = 'low'

        # Confidence is intentionally capped at 0.65 for the heuristic fallback:
        # rule-based signals are noisy and a false sense of high confidence would
        # mislead downstream consumers.  The ML model can return up to 1.0.
        confidence = min(0.65, 0.4 + probability * 0.3)

        return {
            'model_version': 'heuristic-v2.0.0',
            'severity': severity,
            'probability': probability,
            'confidence': confidence,
            'contributing_factors': factors,
            'predicted_at': datetime.utcnow().isoformat()
        }

    def train(self, db_url: str) -> Dict[str, Any]:
        """
        Train severity model on real reports from PostgreSQL (sync wrapper).
        
        Can be called from both sync and async contexts:
        - If an event loop is already running (FastAPI endpoint), offloads to a
          thread to run asyncio.run() without "event loop already running" error.
        - If no loop is running (CLI / pytest), calls asyncio.run() directly.
        """
        import asyncio
        try:
            loop = asyncio.get_running_loop()
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self._train_async(db_url))
                return future.result(timeout=300)
        except RuntimeError:
            return asyncio.run(self._train_async(db_url))

    async def async_train(self, db_url: str) -> Dict[str, Any]:
        """Train severity model (async — call from within running event loop)."""
        return await self._train_async(db_url)

    async def _train_async(self, db_url: str) -> Dict[str, Any]:
        """Advanced training pipeline with ensemble, SMOTE, and rich features."""
        _lazy_imports()

        import asyncpg
        from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
        from sklearn.metrics import (
            accuracy_score, f1_score, classification_report, confusion_matrix,
            precision_score, recall_score
        )
        from sklearn.preprocessing import StandardScaler
        from sklearn.pipeline import Pipeline

        logger.info("Starting severity model training (v3.0 — advanced pipeline)...")

        conn = await asyncpg.connect(db_url)

        try:
            rows = await conn.fetch("""
                SELECT display_type, description, severity, incident_category,
                       ai_confidence, created_at
                FROM reports
                WHERE severity IS NOT NULL
                  AND severity::text IN ('low', 'medium', 'high', 'critical')
                  AND deleted_at IS NULL
                  AND LENGTH(COALESCE(description, '')) > 10
            """)

            if len(rows) < MIN_TRAINING_SAMPLES:
                return {
                    'error': f'Insufficient data: {len(rows)} < {MIN_TRAINING_SAMPLES}',
                    'rows_found': len(rows)
                }

            df = pd.DataFrame([dict(r) for r in rows])
            df['full_text'] = df['display_type'].fillna('') + ' ' + df['description'].fillna('')
            df['label'] = df['severity'].map(SEVERITY_MAP)
            df = df.dropna(subset=['label'])
            df['label'] = df['label'].astype(int)

            # Use only classes that actually exist in the data
            present_classes = sorted(df['label'].unique())
            present_names = [SEVERITY_CLASSES[i] for i in present_classes]
            label_remap = {old: new for new, old in enumerate(present_classes)}
            df['label'] = df['label'].map(label_remap)

            class_counts = df['label'].value_counts()
            logger.info(f"Class distribution:\n{class_counts}")

            for cls_idx, cls_name in enumerate(present_names):
                count = class_counts.get(cls_idx, 0)
                if count < MIN_SAMPLES_PER_CLASS:
                    logger.warning(f"Class '{cls_name}' has only {count} samples")

            # TF-IDF: word n-grams (1-3) — expanded for richer vocabulary
            vectorizer = _tfidf(
                max_features=1200,
                ngram_range=(1, 3),
                min_df=2,
                max_df=0.90,
                stop_words='english',
                sublinear_tf=True,
            )
            X_text = vectorizer.fit_transform(df['full_text']).toarray()

            # TF-IDF: character n-grams (captures morphology/spelling patterns)
            char_vectorizer = _tfidf(
                max_features=300,
                analyzer='char_wb',
                ngram_range=(3, 6),
                min_df=2,
                max_df=0.95,
                sublinear_tf=True,
            )
            X_char = char_vectorizer.fit_transform(df['full_text']).toarray()

            # Engineered numeric features (40+ features)
            X_numeric = np.array([
                self._engineer_numeric_features(
                    row['full_text'],
                    row.get('display_type', ''),
                    row.get('incident_category', '')
                ) for _, row in df.iterrows()
            ])

            X = np.hstack([X_text, X_char, X_numeric])
            y = df['label'].values

            feature_names = (
                list(vectorizer.get_feature_names_out())
                + [f"char_{n}" for n in char_vectorizer.get_feature_names_out()]
                + ['text_len', 'word_count', 'avg_word_len', 'unique_ratio',
                   'sentence_count', 'avg_sentence_len',
                   'critical_kw', 'high_kw', 'medium_kw', 'low_kw',
                   'critical_score', 'high_score', 'medium_score', 'low_score',
                   'critical_ratio', 'high_ratio', 'medium_ratio', 'low_ratio',
                   'urgency_score', 'infra_count', 'casualty_count',
                   'action_count', 'negation_count',
                   'max_number', 'sum_numbers', 'has_large_number',
                   'exclamation', 'caps_ratio', 'number_count',
                   'cat_natural', 'cat_infra', 'cat_public', 'cat_environ', 'cat_community', 'cat_medical',
                   'hz_flood', 'hz_storm', 'hz_wildfire', 'hz_heatwave', 'hz_drought', 'hz_landslide']
            )

            # Scale numeric features
            scaler = StandardScaler()
            n_text = X_text.shape[1] + X_char.shape[1]
            X[:, n_text:] = scaler.fit_transform(X[:, n_text:])

            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42,
                stratify=y if min(np.bincount(y)) >= 2 else None
            )

            # SMOTE oversampling — k_neighbors must be < smallest class count or
            # SMOTE raises a ValueError.  We compute the safe maximum and skip
            # SMOTE entirely when a class has only one sample.
            try:
                from imblearn.over_sampling import SMOTE
                min_class_count = min(np.bincount(y_train))
                k_neighbors = min(5, min_class_count - 1) if min_class_count > 1 else 1
                if k_neighbors >= 1:
                    smote = SMOTE(random_state=42, k_neighbors=k_neighbors)
                    X_train, y_train = smote.fit_resample(X_train, y_train)
                    logger.info(f"SMOTE resampled: {dict(zip(*np.unique(y_train, return_counts=True)))}")
            except ImportError:
                logger.warning("imbalanced-learn not installed — using class_weight instead")
            except Exception as smote_err:
                logger.warning(f"SMOTE failed (non-fatal): {smote_err}")

            # Compute class weights as fallback / supplement
            from sklearn.utils.class_weight import compute_sample_weight
            sample_weights = compute_sample_weight('balanced', y_train)

            # Train XGBoost with tuned hyperparameters
            if _xgb:
                model = _xgb.XGBClassifier(
                    n_estimators=800,
                    max_depth=6,
                    learning_rate=0.03,
                    objective='multi:softprob',
                    num_class=len(present_classes),
                    eval_metric='mlogloss',
                    random_state=42,
                    use_label_encoder=False,
                    min_child_weight=1,
                    subsample=0.85,
                    colsample_bytree=0.75,
                    colsample_bylevel=0.75,
                    reg_alpha=0.05,
                    reg_lambda=1.0,
                    gamma=0.05,
                    max_delta_step=1,     # helps with imbalanced multi-class
                )
            else:
                from sklearn.ensemble import GradientBoostingClassifier
                model = GradientBoostingClassifier(
                    n_estimators=800, max_depth=6, learning_rate=0.03,
                    random_state=42, subsample=0.85,
                )

            model.fit(X_train, y_train, sample_weight=sample_weights)

            y_pred = model.predict(X_test)
            accuracy = accuracy_score(y_test, y_pred)
            f1 = f1_score(y_test, y_pred, average='weighted')
            report = classification_report(
                y_test, y_pred, target_names=present_names,
                output_dict=True, zero_division=0
            )
            cm = confusion_matrix(y_test, y_pred).tolist()

            # Cross-validation for robust estimate
            cv_folds = min(5, min(np.bincount(y)) if min(np.bincount(y)) >= 2 else 2)
            if cv_folds >= 2:
                cv_scores = cross_val_score(model, X, y, cv=StratifiedKFold(cv_folds, shuffle=True, random_state=42),
                                            scoring='accuracy')
                logger.info(f"CV accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})")
            else:
                cv_scores = np.array([accuracy])

            logger.info(f"Severity model trained: accuracy={accuracy:.4f}, F1={f1:.4f}")
            logger.info(f"Report:\n{classification_report(y_test, y_pred, target_names=present_names, zero_division=0)}")

            precision = precision_score(y_test, y_pred, average='weighted', zero_division=0)
            recall = recall_score(y_test, y_pred, average='weighted', zero_division=0)

            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            version = f'ml-v4.0.0-{timestamp}'

            # Save versioned artifacts (always save to version dir for audit)
            version_dir = MODEL_DIR / version
            version_dir.mkdir(parents=True, exist_ok=True)

            with open(version_dir / "severity_xgb_model.pkl", 'wb') as f:
                pickle.dump(model, f)
            with open(version_dir / "severity_tfidf.pkl", 'wb') as f:
                pickle.dump(vectorizer, f)
            with open(version_dir / "severity_char_tfidf.pkl", 'wb') as f:
                pickle.dump(char_vectorizer, f)
            with open(version_dir / "severity_scaler.pkl", 'wb') as f:
                pickle.dump(scaler, f)

            import hashlib as _hashlib
            dataset_hash = _hashlib.sha256(
                df['full_text'].str.cat(sep='|').encode()
            ).hexdigest()[:32]

            metrics = {
                'model_version': version,
                'accuracy': round(accuracy, 4),
                'precision': round(precision, 4),
                'recall': round(recall, 4),
                'f1_weighted': round(f1, 4),
                'cv_accuracy_mean': round(float(cv_scores.mean()), 4),
                'cv_accuracy_std': round(float(cv_scores.std()), 4),
                'classification_report': report,
                'confusion_matrix': cm,
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'total_samples': len(df),
                'feature_count': X.shape[1],
                'text_features': X_text.shape[1],
                'char_features': X_char.shape[1],
                'numeric_features': X_numeric.shape[1],
                'class_distribution': {str(k): int(v) for k, v in class_counts.to_dict().items()},
                'classes': present_names,
                'dataset_hash': dataset_hash,
                'trained_at': datetime.utcnow().isoformat(),
            }

            with open(version_dir / "severity_metrics.json", 'w') as f:
                json.dump(metrics, f, indent=2, default=str)

            # Model Governance: register candidate & compare
            promoted = False
            try:
                from app.core.governance import governance
                await governance.register_candidate(
                    model_name="severity_predictor",
                    version=version,
                    artifact_path=str(version_dir),
                    metrics=metrics,
                    dataset_size=len(df),
                    dataset_hash=dataset_hash,
                    feature_names=feature_names,
                    training_config={"n_estimators": 200, "max_depth": 6, "lr": 0.1},
                )
                promotion = await governance.compare_and_promote(
                    model_name="severity_predictor",
                    candidate_version=version,
                    primary_metric="accuracy",
                    min_improvement=0.0,
                )
                metrics['governance'] = promotion
                promoted = promotion.get('status') == 'promoted'
                logger.info(f"Governance: {promotion.get('status')}")
            except Exception as gov_err:
                logger.warning(f"Governance registration failed (non-fatal): {gov_err}")
                metrics['governance'] = {'status': 'skipped', 'error': str(gov_err)}
                promoted = True  # If governance unavailable, accept the model

            # Only update active model if governance approved (or skipped)
            if promoted:
                with open(self._model_path(), 'wb') as f:
                    pickle.dump(model, f)
                with open(self._vectorizer_path(), 'wb') as f:
                    pickle.dump(vectorizer, f)
                with open(MODEL_DIR / "severity_char_tfidf.pkl", 'wb') as f:
                    pickle.dump(char_vectorizer, f)
                with open(MODEL_DIR / "severity_scaler.pkl", 'wb') as f:
                    pickle.dump(scaler, f)
                with open(self._metrics_path(), 'w') as f:
                    json.dump(metrics, f, indent=2, default=str)
                self.model = model
                self.vectorizer = vectorizer
                self.char_vectorizer = char_vectorizer
                self.scaler = scaler
                self.feature_names = feature_names
                self.model_version = version
                self.training_metrics = metrics
                logger.info(f"Active model updated to {version}")
            else:
                logger.info(f"Keeping previous model — candidate {version} not promoted")

            return metrics

        finally:
            await conn.close()

    def batch_predict(self, reports: List[Dict]) -> List[Dict]:
        """Predict severity for multiple reports."""
        results = []
        for report in reports:
            result = self.predict(
                report.get('text', ''),
                report.get('description', ''),
                report.get('trapped_persons', 0),
                report.get('affected_area_km2', 0),
                report.get('population_affected', 0),
                report.get('hazard_type'),
                report.get('weather_conditions')
            )
            result['report_id'] = report.get('id')
            results.append(result)
        return results
