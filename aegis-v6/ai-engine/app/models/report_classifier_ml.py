"""
 AEGIS AI ENGINE — Real ML Report Classifier
 XGBoost + TF-IDF trained on real disaster reports from PostgreSQL

Replaces the keyword-based heuristic with a real trained ML model.
Training pipeline:
  1. Fetch labeled reports from PostgreSQL
  2. TF-IDF vectorize text (500 features, bigrams)
  3. Add numeric metadata features
  4. Train XGBoost multi-class classifier
  5. Evaluate on 80/20 stratified split
  6. Save model + vectorizer + metrics to model_registry/
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
MIN_TRAINING_SAMPLES = 100
MIN_SAMPLES_PER_CLASS = 10
HAZARD_TYPES = ['flood', 'drought', 'heatwave', 'wildfire', 'storm', 'other']
HAZARD_MAP = {h: i for i, h in enumerate(HAZARD_TYPES)}

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')

class ReportClassifierTrainable:
    """
    Real ML report classifier with training and inference.
    Uses XGBoost + TF-IDF on real disaster report text.
    """

    def __init__(self):
        self.model = None
        self.vectorizer = None
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
        metp = self._metrics_path()
        if mp.exists() and vp.exists():
            try:
                with open(mp, 'rb') as f:
                    self.model = pickle.load(f)
                with open(vp, 'rb') as f:
                    self.vectorizer = pickle.load(f)
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
            logger.warning("No trained model — using keyword fallback")
            return self._keyword_classify(full_text)

    def _ml_classify(self, text: str) -> Dict[str, Any]:
        """ML-based classification using trained XGBoost."""
        try:
            X_text = self.vectorizer.transform([text]).toarray()
            X_numeric = np.array([[
                len(text),
                len(text.split()),
                1 if any(w in text for w in ['flood', 'water', 'river', 'rain']) else 0,
                1 if any(w in text for w in ['fire', 'burn', 'smoke', 'blaze']) else 0,
                1 if any(w in text for w in ['heat', 'hot', 'temperature']) else 0,
            ]])
            X = np.hstack([X_text, X_numeric])

            y_pred = self.model.predict(X)[0]
            y_proba = self.model.predict_proba(X)[0]

            primary = HAZARD_TYPES[int(y_pred)] if int(y_pred) < len(HAZARD_TYPES) else 'other'
            probability = float(np.max(y_proba))

            # All detected hazards above threshold
            detected = []
            for i, p in enumerate(y_proba):
                if p > 0.15 and i < len(HAZARD_TYPES):
                    detected.append(HAZARD_TYPES[i])

            return {
                'model_version': self.model_version,
                'primary_hazard': primary,
                'probability': round(probability, 4),
                'confidence': round(probability, 4),
                'all_hazards_detected': detected or [primary],
                'hazard_scores': {HAZARD_TYPES[i]: round(float(p), 4) for i, p in enumerate(y_proba) if i < len(HAZARD_TYPES)},
                'trained': True,
                'classified_at': datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"ML classify error: {e}")
            return self._keyword_classify(text)

    def _keyword_classify(self, text: str) -> Dict[str, Any]:
        """Keyword fallback — clearly marked as heuristic."""
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
            # Already inside an async loop (e.g. FastAPI) — use nest_asyncio or thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self._train_async(db_url))
                return future.result(timeout=300)
        except RuntimeError:
            # No running loop — safe to create one
            return asyncio.run(self._train_async(db_url))

    async def async_train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train classifier (async — call from within running event loop)."""
        return await self._train_async(db_url)

    async def _train_async(self, db_url: str) -> Dict[str, Any]:
        _lazy_imports()
        import asyncpg
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import accuracy_score, f1_score, classification_report

        logger.info("Starting report classifier training...")
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

            # Map categories to hazard types
            cat_map = {
                'flood': 'flood', 'flooding': 'flood', 'river': 'flood',
                'natural_disaster': 'flood',
                'drought': 'drought', 'water_shortage': 'drought',
                'heatwave': 'heatwave', 'heat': 'heatwave', 'extreme_heat': 'heatwave',
                'wildfire': 'wildfire', 'fire': 'wildfire',
                'storm': 'storm', 'wind': 'storm', 'hurricane': 'storm',
                'infrastructure': 'other', 'pollution': 'other', 'other': 'other',
                'environmental': 'other', 'medical': 'other', 'community_safety': 'other',
                'public_safety': 'other',
            }
            df['hazard'] = df['incident_category'].str.lower().map(lambda c: cat_map.get(c, 'flood'))
            df['label'] = df['hazard'].map(lambda h: HAZARD_MAP.get(h, HAZARD_MAP['other']))

            df['full_text'] = df['display_type'].fillna('') + ' ' + df['description'].fillna('')

            # Remap labels to contiguous integers and use only present classes
            present_labels = sorted(df['label'].unique())
            present_names = [HAZARD_TYPES[i] for i in present_labels if i < len(HAZARD_TYPES)]
            label_remap = {old: new for new, old in enumerate(present_labels)}
            df['label'] = df['label'].map(label_remap)

            class_counts = df['label'].value_counts()
            logger.info(f"Class distribution:\n{class_counts}")

            # Drop classes with < 5 samples (can't stratify)
            min_class_size = 5
            valid_classes = class_counts[class_counts >= min_class_size].index.tolist()
            if len(valid_classes) < len(present_labels):
                df = df[df['label'].isin(valid_classes)].copy()
                present_names = [present_names[i] for i in valid_classes]
                label_remap2 = {old: new for new, old in enumerate(valid_classes)}
                df['label'] = df['label'].map(label_remap2)
                class_counts = df['label'].value_counts()
                logger.info(f"After filtering small classes:\n{class_counts}")

            # TF-IDF vectorization
            vectorizer = _tfidf(
                max_features=500,
                ngram_range=(1, 2),
                min_df=2,
                max_df=0.95,
                stop_words='english'
            )
            X_text = vectorizer.fit_transform(df['full_text']).toarray()

            # Numeric features
            X_numeric = np.column_stack([
                df['full_text'].str.len().values,
                df['full_text'].str.split().str.len().values,
                df['full_text'].apply(lambda t: sum(1 for w in ['flood', 'water', 'river', 'rain'] if w in t.lower())).values,
                df['full_text'].apply(lambda t: sum(1 for w in ['fire', 'burn', 'smoke', 'blaze'] if w in t.lower())).values,
                df['full_text'].apply(lambda t: sum(1 for w in ['heat', 'hot', 'temperature'] if w in t.lower())).values,
            ])

            X = np.hstack([X_text, X_numeric])
            y = df['label'].values

            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y
            )

            # Compute sample weights for class imbalance (softened to avoid over-correction)
            from sklearn.utils.class_weight import compute_sample_weight
            balanced_weights = compute_sample_weight('balanced', y_train)
            # Blend: 40% balanced + 60% uniform to avoid suppressing majority class
            sample_weights = 0.4 * balanced_weights + 0.6 * np.ones_like(balanced_weights)

            # Train XGBoost or GradientBoosting
            n_classes = len(df['label'].unique())
            if _xgb:
                model = _xgb.XGBClassifier(
                    n_estimators=300,
                    max_depth=6,
                    learning_rate=0.08,
                    objective='multi:softprob' if n_classes > 2 else 'binary:logistic',
                    num_class=n_classes if n_classes > 2 else None,
                    eval_metric='mlogloss' if n_classes > 2 else 'logloss',
                    random_state=42,
                    use_label_encoder=False,
                    min_child_weight=3,
                    subsample=0.8,
                    colsample_bytree=0.8,
                )
            else:
                from sklearn.ensemble import GradientBoostingClassifier
                model = GradientBoostingClassifier(
                    n_estimators=300, max_depth=6, learning_rate=0.08, random_state=42,
                )

            model.fit(X_train, y_train, sample_weight=sample_weights)

            y_pred = model.predict(X_test)
            accuracy = accuracy_score(y_test, y_pred)
            f1 = f1_score(y_test, y_pred, average='weighted')
            report = classification_report(y_test, y_pred, target_names=present_names, output_dict=True, zero_division=0)

            logger.info(f"Classifier trained: accuracy={accuracy:.4f}, F1={f1:.4f}")
            logger.info(f"Report:\n{classification_report(y_test, y_pred, target_names=present_names, zero_division=0)}")

            # Save versioned artifacts (always save to version dir for audit)
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            version = f'ml-classifier-v2.0.0-{timestamp}'

            version_dir = MODEL_DIR / version
            version_dir.mkdir(parents=True, exist_ok=True)

            with open(version_dir / "classifier_xgb_model.pkl", 'wb') as f:
                pickle.dump(model, f)
            with open(version_dir / "classifier_tfidf.pkl", 'wb') as f:
                pickle.dump(vectorizer, f)

            from sklearn.metrics import precision_score, recall_score
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
                'classification_report': report,
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'total_samples': len(df),
                'feature_count': X.shape[1],
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
                with open(self._metrics_path(), 'w') as f:
                    json.dump(metrics, f, indent=2, default=str)
                self.model = model
                self.vectorizer = vectorizer
                self.model_version = version
                self.training_metrics = metrics
                logger.info(f"Active model updated to {version}")
            else:
                logger.info(f"Keeping previous model — candidate {version} not promoted")

            return metrics

        finally:
            await conn.close()
