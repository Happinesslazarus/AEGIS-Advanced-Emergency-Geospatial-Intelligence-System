"""
ML report classifier (trained model for report categorisation).

- Called by endpoints.py for report classification (primary classifier)
- Falls back to report_classifier.py if no trained model exists
- Trained via the training pipeline
"""

import os
import pickle
import json
import numpy as np
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime
from loguru import logger

# Lazy imports for heavy ML dependencies

_sklearn_loaded = False
_tfidf = None
_xgb = None
_pd = None

def _lazy_imports():
    global _sklearn_loaded, _tfidf, _xgb, _pd
    if _sklearn_loaded:
        return
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        _tfidf = TfidfVectorizer
    except ImportError:
        logger.error("sklearn not installed")
        raise
    try:
        import xgboost
        _xgb = xgboost
    except ImportError:
        _xgb = None
        logger.warning("xgboost not available, will use sklearn GradientBoosting")
    try:
        import pandas
        _pd = pandas
    except ImportError:
        _pd = None
    _sklearn_loaded = True

# Constants
MODEL_DIR = Path(__file__).parent.parent.parent / "model_registry" / "report_classifier"
MIN_TRAINING_SAMPLES = 50
MIN_SAMPLES_PER_CLASS = 5
HAZARD_TYPES = ['flood', 'storm', 'wildfire', 'heatwave', 'drought', 'landslide',
                'infrastructure', 'public_safety', 'environmental', 'other']
HAZARD_MAP = {h: i for i, h in enumerate(HAZARD_TYPES)}

# Keyword banks per hazard (used for feature engineering)
HAZARD_KEYWORDS = {
    'flood': ['flood', 'flooding', 'flooded', 'water level', 'river', 'inundation', 'submerged',
              'waterlogged', 'burst banks', 'overflow', 'rising water', 'deluge', 'drainage',
              'surface water', 'tidal', 'pluvial', 'fluvial', 'dam', 'spillway'],
    'storm': ['storm', 'hurricane', 'tornado', 'gale', 'wind', 'lightning', 'thunder',
              'blizzard', 'hail', 'cyclone', 'gusts', 'tempest', 'snow', 'ice storm'],
    'wildfire': ['wildfire', 'fire', 'blaze', 'smoke', 'burning', 'flames', 'inferno',
                 'grass fire', 'forest fire', 'bushfire', 'gorse', 'heather fire', 'peat fire',
                 'moorland fire', 'conflagration', 'firebreak'],
    'heatwave': ['heatwave', 'heat wave', 'extreme heat', 'scorching', 'heat exhaustion',
                 'heat stroke', 'temperature', 'sweltering', 'hot', 'cooling centre'],
    'drought': ['drought', 'dry', 'arid', 'water shortage', 'crop failure', 'reservoir',
                'hosepipe ban', 'water restriction', 'low rainfall', 'water supply'],
    'landslide': ['landslide', 'mudslide', 'rockfall', 'slope failure', 'debris flow',
                  'landslip', 'cliff collapse', 'erosion', 'retaining wall'],
    'infrastructure': ['power', 'electricity', 'gas leak', 'water main', 'bridge', 'road',
                       'railway', 'signal failure', 'cable', 'outage', 'burst pipe',
                       'crane', 'construction', 'pothole', 'broadband'],
    'public_safety': ['chemical', 'hazmat', 'explosion', 'collapse', 'ordnance', 'bomb',
                      'ammonia', 'asbestos', 'carbon monoxide', 'suspicious', 'evacuation'],
    'environmental': ['oil spill', 'pollution', 'contamination', 'algal bloom', 'sewage',
                      'toxic', 'mercury', 'slurry', 'invasive species', 'air quality'],
}

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')

class ReportClassifierTrainable:
    """
    Real ML report classifier with training and inference.
    Uses XGBoost + TF-IDF on real disaster report text.
    """

    def __init__(self):
        self.model = None
        self.vectorizer = None
        self.char_vectorizer = None
        self.scaler = None
        self.feature_names: List[str] = []
        self.model_version = 'untrained'
        self.training_metrics: Dict[str, Any] = {}
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        self._load_model()
        logger.info(f"Report classifier initialized: {self.model_version}")

    def _model_path(self) -> Path:
        return MODEL_DIR / "classifier_xgb_model.pkl"

    def _vectorizer_path(self) -> Path:
        return MODEL_DIR / "classifier_tfidf.pkl"

    def _metrics_path(self) -> Path:
        return MODEL_DIR / "classifier_metrics.json"

    def _load_model(self):
        mp = self._model_path()
        vp = self._vectorizer_path()
        char_vp = MODEL_DIR / "classifier_char_tfidf.pkl"
        scaler_p = MODEL_DIR / "classifier_scaler.pkl"
        metp = self._metrics_path()
        if mp.exists() and vp.exists():
            try:
                with open(mp, 'rb') as f:
                    self.model = pickle.load(f)
                with open(vp, 'rb') as f:
                    self.vectorizer = pickle.load(f)
                if char_vp.exists():
                    with open(char_vp, 'rb') as f:
                        self.char_vectorizer = pickle.load(f)
                if scaler_p.exists():
                    with open(scaler_p, 'rb') as f:
                        self.scaler = pickle.load(f)
                if metp.exists():
                    with open(metp, 'r') as f:
                        self.training_metrics = json.load(f)
                self.model_version = self.training_metrics.get('model_version', 'ml-classifier-v1')
                logger.info(f"Loaded classifier: {self.model_version}, "
                            f"accuracy={self.training_metrics.get('accuracy', 'N/A')}")
            except Exception as e:
                logger.error(f"Failed to load classifier model: {e}")
                self.model = None

    def classify(self, text: str, description: str = "", location: str = "") -> Dict[str, Any]:
        """Classify a disaster report into hazard type."""
        full_text = f"{text} {description} {location}".lower().strip()

        if self.model is not None and self.vectorizer is not None:
            return self._ml_classify(full_text)
        else:
            logger.warning("No trained model -- using keyword fallback")
            return self._keyword_classify(full_text)

    @staticmethod
    def _engineer_features(text: str) -> np.ndarray:
        """Engineer 30+ numeric features from report text."""
        import re
        text_lower = text.lower()
        words = text_lower.split()
        word_count = len(words)
        text_len = len(text_lower)

        # Per-hazard keyword density: count / word_count * 10 normalises to
        # "hits per 100 words" so short and long texts get comparable scores.
        hazard_scores = []
        for hazard in ['flood', 'storm', 'wildfire', 'heatwave', 'drought',
                       'landslide', 'infrastructure', 'public_safety', 'environmental']:
            kws = HAZARD_KEYWORDS.get(hazard, [])
            count = sum(1 for kw in kws if kw in text_lower)
            hazard_scores.append(count / max(1, word_count) * 10)  # density

        # Text complexity
        avg_word_len = np.mean([len(w) for w in words]) if words else 0
        unique_ratio = len(set(words)) / max(1, word_count)
        sentence_count = max(1, len(re.split(r'[.!?]+', text_lower)))
        avg_sentence_len = word_count / sentence_count

        # Urgency signals
        urgency_words = ['emergency', 'urgent', 'critical', 'immediate', 'evacuate',
                         'rescue', 'danger', 'life-threatening', 'catastrophic']
        urgency_count = sum(1 for w in urgency_words if w in text_lower)

        # Impact signals
        casualty_words = ['death', 'injury', 'casualty', 'victim', 'trapped', 'missing']
        infra_words = ['road', 'bridge', 'power', 'railway', 'hospital', 'school', 'dam']
        casualty_count = sum(1 for w in casualty_words if w in text_lower)
        infra_count = sum(1 for w in infra_words if w in text_lower)

        # Text quality
        exclamation = text.count('!')
        caps_ratio = sum(1 for c in text if c.isupper()) / max(1, text_len)
        number_count = len(re.findall(r'\d+', text))
        has_location = 1.0 if re.search(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*', text) else 0.0

        return np.array([
            text_len, word_count, avg_word_len, unique_ratio,
            sentence_count, avg_sentence_len,
            *hazard_scores,  # 9 features
            urgency_count, casualty_count, infra_count,
            exclamation, caps_ratio, number_count, has_location,
        ], dtype=np.float32)

    def _ml_classify(self, text: str) -> Dict[str, Any]:
        """ML-based classification using trained XGBoost."""
        if self.model is None or self.vectorizer is None:
            logger.warning("Model or vectorizer is None -- falling back to keyword classifier")
            return self._keyword_classify(text)
        try:
            X_text = self.vectorizer.transform([text]).toarray()

            # Char n-gram features: if no char vectorizer was saved (older models),
            # pad with zeros to preserve feature vector width.
            if self.char_vectorizer:
                X_char = self.char_vectorizer.transform([text]).toarray()
            else:
                X_char = np.zeros((1, 200))

            X_numeric = self._engineer_features(text).reshape(1, -1)

            # Scale numeric features
            if self.scaler:
                X_numeric = self.scaler.transform(X_numeric)

            X = np.hstack([X_text, X_char, X_numeric])

            y_pred = self.model.predict(X)[0]
            y_proba = self.model.predict_proba(X)[0]

            # Map prediction to hazard class names (handle label remapping)
            classes = self.training_metrics.get('classes', HAZARD_TYPES)
            pred_idx = int(y_pred)
            primary = classes[pred_idx] if pred_idx < len(classes) else 'other'
            probability = float(np.max(y_proba))

            # All detected hazards above threshold: include secondary hazards
            # that exceed 10% probability for multi-hazard incident reports
            # (e.g. a storm causing flooding would show both 'storm' and 'flood').
            detected = []
            hazard_scores = {}
            for i, p in enumerate(y_proba):
                if i < len(classes):
                    hazard_scores[classes[i]] = round(float(p), 4)
                    if p > 0.10:
                        detected.append(classes[i])

            return {
                'model_version': self.model_version,
                'primary_hazard': primary,
                'probability': round(probability, 4),
                'confidence': round(probability, 4),
                'all_hazards_detected': detected or [primary],
                'hazard_scores': hazard_scores,
                'trained': True,
                'classified_at': datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"ML classify error: {e}")
            return self._keyword_classify(text)

    def _keyword_classify(self, text: str) -> Dict[str, Any]:
        """Keyword fallback -- clearly marked as heuristic."""
        keywords = {
            'flood': ['flood', 'flooding', 'water level', 'river', 'inundation', 'submerged', 'waterlogged'],
            'drought': ['drought', 'dry', 'water shortage', 'crop failure', 'arid'],
            'heatwave': ['heatwave', 'heat wave', 'extreme heat', 'scorching', 'heat stroke'],
            'wildfire': ['wildfire', 'fire', 'blaze', 'smoke', 'burning', 'flames'],
            'storm': ['storm', 'hurricane', 'tornado', 'gale', 'wind damage', 'cyclone'],
        }
        scores = {}
        for hazard, kws in keywords.items():
            scores[hazard] = sum(1 for kw in kws if kw in text)

        if not any(scores.values()):
            primary = 'other'
            conf = 0.3
        else:
            primary = max(scores, key=scores.get)
            total = sum(scores.values())
            conf = min(0.85, 0.4 + (scores[primary] / (total + 1)) * 0.4)

        return {
            'model_version': 'keyword-fallback-v1',
            'primary_hazard': primary,
            'probability': round(conf, 4),
            'confidence': round(conf, 4),
            'all_hazards_detected': [h for h, s in scores.items() if s > 0] or [primary],
            'hazard_scores': scores,
            'trained': False,
            'classified_at': datetime.utcnow().isoformat()
        }

    def train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train classifier on real reports from PostgreSQL (sync wrapper)."""
        import asyncio
        try:
            loop = asyncio.get_running_loop()
            # Already inside an async loop (e.g. FastAPI) -- use nest_asyncio or thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self._train_async(db_url))
                return future.result(timeout=300)
        except RuntimeError:
            # No running loop -- safe to create one
            return asyncio.run(self._train_async(db_url))

    async def async_train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train classifier (async -- call from within running event loop)."""
        return await self._train_async(db_url)

    async def _train_async(self, db_url: str) -> Dict[str, Any]:
        _lazy_imports()
        import asyncpg
        from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
        from sklearn.metrics import (
            accuracy_score, f1_score, classification_report,
            precision_score, recall_score
        )
        from sklearn.preprocessing import StandardScaler

        logger.info("Starting report classifier training (v3.0 -- multi-hazard)...")
        conn = await asyncpg.connect(db_url)

        try:
            rows = await conn.fetch("""
                SELECT display_type, description, incident_category,
                       severity, ai_confidence, created_at
                FROM reports
                WHERE incident_category IS NOT NULL
                  AND deleted_at IS NULL
                  AND LENGTH(COALESCE(description, '')) > 10
            """)

            if len(rows) < MIN_TRAINING_SAMPLES:
                return {'error': f'Insufficient data: {len(rows)} < {MIN_TRAINING_SAMPLES}', 'rows_found': len(rows)}

            import pandas as pd
            df = pd.DataFrame([dict(r) for r in rows])

            # Hazard resolution: prefer display_type (e.g. "Flood", "Severe Storm")
            # because it is explicitly chosen from a controlled vocabulary, whereas
            # incident_category is a broader bucket (e.g. "natural_disaster" covers
            # flood/storm/heatwave/wildfire -- not specific enough for classification).
            display_map = {
                'flood': 'flood', 'severe storm': 'storm', 'storm': 'storm',
                'wildfire': 'wildfire', 'heatwave': 'heatwave', 'heat wave': 'heatwave',
                'drought': 'drought', 'landslide': 'landslide',
                'infrastructure damage': 'infrastructure', 'infrastructure': 'infrastructure',
                'public safety': 'public_safety', 'environmental hazard': 'environmental',
                'environmental': 'environmental', 'unknown': 'other',
            }
            category_map = {
                'natural_disaster': None,  # resolve from display_type or text
                'infrastructure': 'infrastructure',
                'public_safety': 'public_safety',
                'environmental': 'environmental',
                'community_safety': 'public_safety',
                'medical': 'other',
            }

            def resolve_hazard(row):
                """Resolve hazard type from display_type, then category, then text keywords."""
                dt = str(row.get('display_type', '')).lower().strip()
                if dt in display_map:
                    return display_map[dt]

                cat = str(row.get('incident_category', '')).lower().strip()
                cat_resolved = category_map.get(cat)
                if cat_resolved:
                    return cat_resolved

                # Text-based fallback for natural_disaster without clear display_type
                text = f"{row.get('display_type', '')} {row.get('description', '')}".lower()
                best_hazard, best_score = 'other', 0
                for hazard, keywords in HAZARD_KEYWORDS.items():
                    score = sum(1 for kw in keywords if kw in text)
                    if score > best_score:
                        best_score = score
                        best_hazard = hazard
                return best_hazard

            df['hazard'] = df.apply(resolve_hazard, axis=1)
            df['label'] = df['hazard'].map(lambda h: HAZARD_MAP.get(h, HAZARD_MAP['other']))
            df['full_text'] = df['display_type'].fillna('') + ' ' + df['description'].fillna('')

            # Remap labels to contiguous integers
            present_labels = sorted(df['label'].unique())
            present_names = [HAZARD_TYPES[i] for i in present_labels if i < len(HAZARD_TYPES)]
            label_remap = {old: new for new, old in enumerate(present_labels)}
            df['label'] = df['label'].map(label_remap)

            class_counts = df['label'].value_counts()
            logger.info(f"Hazard distribution ({len(present_names)} classes):\n{class_counts}")
            for idx, name in enumerate(present_names):
                logger.info(f"  {idx} -> {name}: {class_counts.get(idx, 0)} samples")

            # Drop classes with < 3 samples
            valid_classes = class_counts[class_counts >= 3].index.tolist()
            if len(valid_classes) < len(present_labels):
                df = df[df['label'].isin(valid_classes)].copy()
                present_names = [present_names[i] for i in valid_classes]
                label_remap2 = {old: new for new, old in enumerate(valid_classes)}
                df['label'] = df['label'].map(label_remap2)
                class_counts = df['label'].value_counts()
                logger.info(f"After filtering small classes: {len(present_names)} classes remain")

            # TF-IDF: word n-grams (1-3)
            vectorizer = _tfidf(
                max_features=800,
                ngram_range=(1, 3),
                min_df=2,
                max_df=0.92,
                stop_words='english',
                sublinear_tf=True,
            )
            X_text = vectorizer.fit_transform(df['full_text']).toarray()

            # TF-IDF: character n-grams
            char_vectorizer = _tfidf(
                max_features=200,
                analyzer='char_wb',
                ngram_range=(3, 5),
                min_df=2,
                max_df=0.95,
                sublinear_tf=True,
            )
            X_char = char_vectorizer.fit_transform(df['full_text']).toarray()

            # Engineered numeric features
            X_numeric = np.array([
                self._engineer_features(row['full_text']) for _, row in df.iterrows()
            ])

            # Scale numeric features
            scaler = StandardScaler()
            X_numeric_scaled = scaler.fit_transform(X_numeric)

            X = np.hstack([X_text, X_char, X_numeric_scaled])
            y = df['label'].values

            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42,
                stratify=y if min(np.bincount(y)) >= 2 else None
            )

            # SMOTE oversampling
            try:
                from imblearn.over_sampling import SMOTE
                min_class_count = min(np.bincount(y_train))
                k = min(5, min_class_count - 1) if min_class_count > 1 else 1
                if k >= 1:
                    smote = SMOTE(random_state=42, k_neighbors=k)
                    X_train, y_train = smote.fit_resample(X_train, y_train)
                    logger.info(f"SMOTE: {dict(zip(*np.unique(y_train, return_counts=True)))}")
            except ImportError:
                logger.warning("imbalanced-learn not installed")
            except Exception as e:
                logger.warning(f"SMOTE failed: {e}")

            from sklearn.utils.class_weight import compute_sample_weight
            sample_weights = compute_sample_weight('balanced', y_train)

            # Train XGBoost
            n_classes = len(df['label'].unique())
            if _xgb:
                model = _xgb.XGBClassifier(
                    n_estimators=500,
                    max_depth=5,
                    learning_rate=0.05,
                    objective='multi:softprob' if n_classes > 2 else 'binary:logistic',
                    num_class=n_classes if n_classes > 2 else None,
                    eval_metric='mlogloss' if n_classes > 2 else 'logloss',
                    random_state=42,
                    use_label_encoder=False,
                    min_child_weight=2,
                    subsample=0.8,
                    colsample_bytree=0.7,
                    reg_alpha=0.1,
                    reg_lambda=1.5,
                    gamma=0.1,
                )
            else:
                from sklearn.ensemble import GradientBoostingClassifier
                model = GradientBoostingClassifier(
                    n_estimators=500, max_depth=5, learning_rate=0.05,
                    random_state=42, subsample=0.8,
                )

            model.fit(X_train, y_train, sample_weight=sample_weights)

            y_pred = model.predict(X_test)
            accuracy = accuracy_score(y_test, y_pred)
            f1 = f1_score(y_test, y_pred, average='weighted')
            report = classification_report(y_test, y_pred, target_names=present_names,
                                           output_dict=True, zero_division=0)

            # Cross-validation
            cv_folds = min(5, min(np.bincount(y)) if min(np.bincount(y)) >= 2 else 2)
            if cv_folds >= 2:
                cv_scores = cross_val_score(model, X, y,
                                            cv=StratifiedKFold(cv_folds, shuffle=True, random_state=42),
                                            scoring='accuracy')
                logger.info(f"CV accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})")
            else:
                cv_scores = np.array([accuracy])

            logger.info(f"Classifier trained: accuracy={accuracy:.4f}, F1={f1:.4f}")
            logger.info(f"Report:\n{classification_report(y_test, y_pred, target_names=present_names, zero_division=0)}")

            # Save versioned artifacts
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            version = f'ml-classifier-v3.0.0-{timestamp}'

            version_dir = MODEL_DIR / version
            version_dir.mkdir(parents=True, exist_ok=True)

            with open(version_dir / "classifier_xgb_model.pkl", 'wb') as f:
                pickle.dump(model, f)
            with open(version_dir / "classifier_tfidf.pkl", 'wb') as f:
                pickle.dump(vectorizer, f)
            with open(version_dir / "classifier_char_tfidf.pkl", 'wb') as f:
                pickle.dump(char_vectorizer, f)
            with open(version_dir / "classifier_scaler.pkl", 'wb') as f:
                pickle.dump(scaler, f)

            precision = precision_score(y_test, y_pred, average='weighted', zero_division=0)
            recall_val = recall_score(y_test, y_pred, average='weighted', zero_division=0)

            import hashlib as _hashlib
            dataset_hash = _hashlib.sha256(
                df['full_text'].str.cat(sep='|').encode()
            ).hexdigest()[:32]

            metrics = {
                'model_version': version,
                'accuracy': round(accuracy, 4),
                'precision': round(precision, 4),
                'recall': round(recall_val, 4),
                'f1_weighted': round(f1, 4),
                'cv_accuracy_mean': round(float(cv_scores.mean()), 4),
                'cv_accuracy_std': round(float(cv_scores.std()), 4),
                'classification_report': report,
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'total_samples': len(df),
                'feature_count': X.shape[1],
                'text_features': X_text.shape[1],
                'char_features': X_char.shape[1],
                'numeric_features': X_numeric.shape[1],
                'class_distribution': {str(k): int(v) for k, v in class_counts.to_dict().items()},
                'hazard_types': HAZARD_TYPES,
                'classes': present_names,
                'dataset_hash': dataset_hash,
                'trained_at': datetime.utcnow().isoformat(),
            }
            with open(version_dir / "classifier_metrics.json", 'w') as f:
                json.dump(metrics, f, indent=2, default=str)

            # Model Governance: register candidate & compare
            promoted = False
            try:
                from app.core.governance import governance
                await governance.register_candidate(
                    model_name="report_classifier",
                    version=version,
                    artifact_path=str(version_dir),
                    metrics=metrics,
                    dataset_size=len(df),
                    dataset_hash=dataset_hash,
                    feature_names=list(vectorizer.get_feature_names_out()) + ['text_len', 'word_count', 'flood_kw', 'fire_kw', 'heat_kw'],
                    training_config={"n_estimators": 300, "max_depth": 6, "lr": 0.08},
                )
                promotion = await governance.compare_and_promote(
                    model_name="report_classifier",
                    candidate_version=version,
                    primary_metric="f1_weighted",
                    min_improvement=-0.01,
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
                with open(MODEL_DIR / "classifier_char_tfidf.pkl", 'wb') as f:
                    pickle.dump(char_vectorizer, f)
                with open(MODEL_DIR / "classifier_scaler.pkl", 'wb') as f:
                    pickle.dump(scaler, f)
                with open(self._metrics_path(), 'w') as f:
                    json.dump(metrics, f, indent=2, default=str)
                self.model = model
                self.vectorizer = vectorizer
                self.char_vectorizer = char_vectorizer
                self.scaler = scaler
                self.model_version = version
                self.training_metrics = metrics
                logger.info(f"Active model updated to {version}")
            else:
                logger.info(f"Keeping previous model -- candidate {version} not promoted")

            return metrics

        finally:
            await conn.close()
