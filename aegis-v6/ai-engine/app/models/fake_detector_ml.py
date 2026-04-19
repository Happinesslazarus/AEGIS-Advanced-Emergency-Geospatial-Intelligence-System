"""
ML-based fake report detector (trained classifier for report authenticity).

- Called by endpoints.py for fake report detection (primary detector)
- Falls back to fake_detector.py if no trained model exists
- Trained via the training pipeline (train_all.py)
"""

import os
import pickle
import json
import re
import numpy as np
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime
from loguru import logger

MODEL_DIR = Path(__file__).parent.parent.parent / "model_registry" / "fake_detector"
DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')
MIN_TRAINING_SAMPLES = 50

class FakeDetectorTrainable:
    """
    Real ML fake/spam report detector.
    Uses XGBoost trained on text + metadata features.
    """

    def __init__(self):
        self.model = None
        self.vectorizer = None
        self.char_vectorizer = None
        self.scaler = None
        self.model_version = 'untrained'
        self.training_metrics: Dict[str, Any] = {}
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        self._load_model()
        logger.info(f"Fake detector initialized: {self.model_version}")

    def _model_path(self) -> Path:
        return MODEL_DIR / "fake_xgb_model.pkl"

    def _metrics_path(self) -> Path:
        return MODEL_DIR / "fake_metrics.json"

    def _load_model(self):
        mp = self._model_path()
        metp = self._metrics_path()
        vec_p = MODEL_DIR / "fake_tfidf.pkl"
        char_p = MODEL_DIR / "fake_char_tfidf.pkl"
        scaler_p = MODEL_DIR / "fake_scaler.pkl"
        if mp.exists():
            try:
                with open(mp, 'rb') as f:
                    self.model = pickle.load(f)
                if vec_p.exists():
                    with open(vec_p, 'rb') as f:
                        self.vectorizer = pickle.load(f)
                if char_p.exists():
                    with open(char_p, 'rb') as f:
                        self.char_vectorizer = pickle.load(f)
                if scaler_p.exists():
                    with open(scaler_p, 'rb') as f:
                        self.scaler = pickle.load(f)
                if metp.exists():
                    with open(metp, 'r') as f:
                        self.training_metrics = json.load(f)
                self.model_version = self.training_metrics.get('model_version', 'ml-fake-v1')
                logger.info(f"Loaded fake detector: {self.model_version}")
            except Exception as e:
                logger.error(f"Failed to load fake detector: {e}")
                self.model = None

    @staticmethod
    def _extract_features(
        text: str,
        description: str = "",
        user_reputation: float = 0.5,
        image_count: int = 0,
        location_verified: bool = False,
        source_type: str = "user_report",
        submission_frequency: int = 1,
        similar_reports_count: int = 0
    ) -> np.ndarray:
        """Extract 25+ numeric features from report data (v4.0 — enhanced)."""
        full_text = f"{text} {description}".lower()
        original_text = f"{text} {description}"
        words = full_text.split()
        word_count = len(words)
        text_len = len(full_text)

        # Text quality features
        avg_word_len = np.mean([len(w) for w in words]) if word_count > 0 else 0
        unique_ratio = len(set(words)) / max(1, word_count)
        special_char_ratio = len(re.findall(r'[^a-zA-Z0-9\s]', full_text)) / max(1, text_len)
        caps_ratio = len(re.findall(r'[A-Z]', original_text)) / max(1, len(original_text))
        url_count = len(re.findall(r'http[s]?://', full_text))
        exclamation_count = full_text.count('!')
        sentence_count = max(1, len(re.split(r'[.!?]+', full_text)))
        avg_sentence_len = word_count / sentence_count

        # Specificity score (genuine reports have specific details)
        has_numbers = len(re.findall(r'\b\d+\b', full_text))
        has_location = len(re.findall(r'\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b', original_text))
        specificity_score = min(1.0, (has_numbers * 0.15 + has_location * 0.1 + word_count * 0.005))

        # Spam indicator keywords
        spam_words = ['buy', 'sell', 'cheap', 'discount', 'offer', 'click', 'free', 'win',
                      'prize', 'lottery', 'subscribe', 'guaranteed', 'bonus', 'viagra', 'casino']
        spam_count = sum(1 for w in spam_words if w in full_text)

        # Disaster relevance keywords
        disaster_words = ['flood', 'water', 'rain', 'storm', 'damage', 'emergency', 'evacuate',
                          'rescue', 'destroyed', 'collapsed', 'injured', 'trapped', 'fire',
                          'earthquake', 'landslide', 'drought', 'heatwave', 'tornado']
        disaster_count = sum(1 for w in disaster_words if w in full_text)

        # Fake indicator keywords
        fake_words = ['hoax', 'rumor', 'prank', 'joke', 'fake', 'allegedly', 'supposedly',
                      'unconfirmed', 'misleading', 'clickbait']
        fake_count = sum(1 for w in fake_words if w in full_text)

        # Vague / low-effort keywords
        vague_words = ['something', 'maybe', 'i think', 'not sure', 'probably', 'someone said',
                       'heard that', 'might be', 'idk', 'lol', 'lmao']
        vague_count = sum(1 for w in vague_words if w in full_text)

        # Repetition detection (spam signal)
        word_freq = {}
        for w in words:
            word_freq[w] = word_freq.get(w, 0) + 1
        max_word_freq = max(word_freq.values()) if word_freq else 0
        repetition_ratio = max_word_freq / max(1, word_count)

        # Source encoding
        source_map = {'official': 0, 'verified_user': 1, 'user_report': 2, 'social_media': 3, 'anonymous': 4}
        source_val = source_map.get(source_type, 2)

        return np.array([
            text_len, word_count, avg_word_len, unique_ratio,
            special_char_ratio, caps_ratio,
            url_count, exclamation_count,
            sentence_count, avg_sentence_len,
            specificity_score,
            spam_count, disaster_count, fake_count, vague_count,
            repetition_ratio,
            user_reputation,
            image_count,
            1 if location_verified else 0,
            source_val,
            submission_frequency,
            similar_reports_count,
            has_numbers, has_location,
        ], dtype=np.float64)

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
        """Detect if a report is fake/spam using trained ML or rule-based fallback."""
        metadata_features = self._extract_features(
            text, description, user_reputation, image_count,
            location_verified, source_type, submission_frequency, similar_reports_count
        )

        if self.model is not None:
            return self._ml_detect(text, description, metadata_features)
        else:
            result = self._rule_detect(metadata_features, text, description, user_reputation)
            result['fallback_reason'] = 'model_untrained_or_unavailable'
            result['requires_human_review'] = result.get('classification') in {'questionable', 'suspicious', 'likely_fake'}
            return result

    def _ml_detect(self, text: str, description: str, metadata_features: np.ndarray) -> Dict[str, Any]:
        """ML-based detection using TF-IDF text + metadata features."""
        try:
            full_text = f"{text} {description}".lower()

            # Build feature vector matching training layout
            parts = []

            # TF-IDF word features
            if self.vectorizer:
                parts.append(self.vectorizer.transform([full_text]).toarray())
            # TF-IDF char features
            if self.char_vectorizer:
                parts.append(self.char_vectorizer.transform([full_text]).toarray())

            # Metadata features (scaled)
            meta = metadata_features.reshape(1, -1)
            if self.scaler:
                meta = self.scaler.transform(meta)
            parts.append(meta)

            X = np.hstack(parts)
            y_pred = self.model.predict(X)[0]
            y_proba = self.model.predict_proba(X)[0]

            fake_prob = float(y_proba[1]) if len(y_proba) > 1 else float(y_pred)

            if fake_prob >= 0.75:
                classification = 'likely_fake'
                action = 'reject'
            elif fake_prob >= 0.50:
                classification = 'suspicious'
                action = 'flag_for_review'
            elif fake_prob >= 0.25:
                classification = 'questionable'
                action = 'monitor'
            else:
                classification = 'genuine'
                action = 'accept'

            return {
                'model_version': self.model_version,
                'is_fake': fake_prob > 0.5,
                'fake_probability': round(fake_prob, 4),
                'classification': classification,
                'confidence': round(1.0 - min(abs(fake_prob - 0.5) * 2, 0.5) + 0.5, 4),
                'recommended_action': action,
                'trained': True,
                'detected_at': datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"ML fake detection error: {e}")
            return self._rule_detect(metadata_features, text, description, 0.5)

    def _rule_detect(self, features: np.ndarray, text: str, description: str, reputation: float) -> Dict[str, Any]:
        """Rule-based fallback — clearly marked as heuristic."""
        full_text = f"{text} {description}".lower()
        score = 0.0
        flags = []

        if len(full_text) < 20:
            score += 20; flags.append("text_too_short")
        if len(features) > 7 and features[7] > 0:  # spam_count
            score += features[7] * 10; flags.append("spam_keywords")
        if len(features) > 9 and features[9] > 0:  # fake_count
            score += features[9] * 15; flags.append("fake_indicators")
        if reputation < 0.3:
            score += 15; flags.append("low_reputation")
        if len(features) > 5 and features[5] > 0:  # url_count
            score += 10; flags.append("contains_urls")

        fake_prob = min(1.0, score / 100.0)

        if fake_prob >= 0.75:
            classification = 'likely_fake'
            action = 'reject'
        elif fake_prob >= 0.50:
            classification = 'suspicious'
            action = 'flag_for_review'
        elif fake_prob >= 0.25:
            classification = 'questionable'
            action = 'manual_review'
        else:
            classification = 'genuine'
            action = 'accept_with_monitoring'

        return {
            'model_version': 'rule-fallback-v1',
            'is_fake': fake_prob > 0.5,
            'fake_probability': round(fake_prob, 4),
            'classification': classification,
            'confidence': round(0.55, 4),
            'recommended_action': action,
            'red_flags': flags,
            'trained': False,
            'fallback_mode': True,
            'detected_at': datetime.utcnow().isoformat()
        }

    def train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train fake detector on real reports from PostgreSQL (sync wrapper)."""
        import asyncio
        try:
            asyncio.get_running_loop()
            # Already inside an async loop (e.g. FastAPI) — run in a separate thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self._train_async(db_url))
                return future.result(timeout=300)
        except RuntimeError:
            # No running loop — safe to create one
            return asyncio.run(self._train_async(db_url))

    async def async_train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train fake detector (async — call from within running event loop)."""
        return await self._train_async(db_url)

    async def _train_async(self, db_url: str) -> Dict[str, Any]:
        import asyncpg
        from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
        from sklearn.metrics import (
            accuracy_score, f1_score, classification_report, roc_auc_score,
            precision_score, recall_score
        )
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.preprocessing import StandardScaler

        logger.info("Starting fake detector training (v3.0 — text+metadata ensemble)...")
        conn = await asyncio.wait_for(asyncpg.connect(db_url), timeout=30.0)

        try:
            rows = await conn.fetch("""
                SELECT r.display_type, r.description, r.incident_category, r.severity,
                       r.status::text as status,
                       ST_X(r.coordinates) as longitude, ST_Y(r.coordinates) as latitude,
                       r.has_media,
                       r.ai_confidence, r.created_at, r.reporter_name,
                       COALESCE(rs.trust_score, 0.5) as trust_score,
                       COALESCE(rs.total_reports, 1) as total_reports,
                       COALESCE(rs.genuine_reports, 0) as verified_reports
                FROM reports r
                LEFT JOIN reporter_scores rs ON r.reporter_ip = rs.ip_hash
                WHERE r.deleted_at IS NULL
                  AND LENGTH(COALESCE(r.description, '')) > 5
            """)

            if len(rows) < MIN_TRAINING_SAMPLES:
                return {'error': f'Insufficient data: {len(rows)} < {MIN_TRAINING_SAMPLES}', 'rows_found': len(rows)}

            import pandas as pd
            df = pd.DataFrame([dict(r) for r in rows])

            for col in ['trust_score', 'ai_confidence']:
                if col in df.columns:
                    df[col] = df[col].astype(float)

            df['full_text'] = df['display_type'].fillna('') + ' ' + df['description'].fillna('')

            # Auto-labeling with multiple signals
            df['label'] = 0  # default: genuine

            # Reports explicitly marked as false/flagged/rejected
            if 'status' in df.columns:
                fake_status_mask = df['status'].isin(['false_report', 'flagged', 'rejected', 'fake'])
                df.loc[fake_status_mask, 'label'] = 1

            # Trust-based signals
            suspicious_mask = (
                (df['trust_score'] < 0.25) |
                ((df['trust_score'] < 0.40) & (df['verified_reports'] == 0)) |
                (df['description'].str.len() < 15) |
                df['description'].apply(lambda t: bool(re.search(r'http[s]?://', str(t).lower())))
            )
            df.loc[suspicious_mask, 'label'] = 1

            # Text quality signals
            spam_words = ['buy', 'sell', 'cheap', 'discount', 'click', 'free', 'win', 'prize',
                          'lottery', 'subscribe', 'guaranteed', 'bonus', 'offer']
            fake_words = ['hoax', 'rumor', 'prank', 'joke', 'fake', 'misleading', 'supposedly',
                          'allegedly', 'unconfirmed']
            df['spam_score'] = df['full_text'].apply(
                lambda t: sum(1 for w in spam_words if w in t.lower())
            )
            df['fake_score'] = df['full_text'].apply(
                lambda t: sum(1 for w in fake_words if w in t.lower())
            )
            df.loc[(df['spam_score'] >= 2) | (df['fake_score'] >= 2), 'label'] = 1

            genuine_count = (df['label'] == 0).sum()
            fake_count = (df['label'] == 1).sum()
            logger.info(f"Auto-labeled: {genuine_count} genuine, {fake_count} suspicious")

            if fake_count < 10:
                df['text_quality'] = (
                    df['description'].str.len() / df['description'].str.len().max()
                    + df['trust_score']
                    + df['has_media'].astype(float) * 0.2
                )
                low_quality = df.nsmallest(max(50, len(df) // 8), 'text_quality')
                df.loc[low_quality.index, 'label'] = 1
                fake_count = (df['label'] == 1).sum()
                logger.info(f"Augmented: now {fake_count} suspicious samples")

            # TF-IDF: word n-grams
            vectorizer = TfidfVectorizer(
                max_features=500,
                ngram_range=(1, 3),
                min_df=2,
                max_df=0.95,
                stop_words='english',
                sublinear_tf=True,
            )
            X_text = vectorizer.fit_transform(df['full_text']).toarray()

            # TF-IDF: char n-grams (catches obfuscation like "fr33", "cl1ck")
            char_vectorizer = TfidfVectorizer(
                max_features=200,
                analyzer='char_wb',
                ngram_range=(3, 5),
                min_df=2,
                max_df=0.95,
                sublinear_tf=True,
            )
            X_char = char_vectorizer.fit_transform(df['full_text']).toarray()

            # Metadata features
            features = []
            for _, row in df.iterrows():
                f = self._extract_features(
                    str(row.get('display_type', '')),
                    str(row.get('description', '')),
                    float(row.get('trust_score', 0.5)),
                    1 if row.get('has_media') else 0,
                    bool(row.get('latitude')),
                    'user_report',
                    int(row.get('total_reports', 1)),
                    0
                )
                features.append(f)
            X_metadata = np.array(features)

            # Scale metadata features
            scaler = StandardScaler()
            X_metadata_scaled = scaler.fit_transform(X_metadata)

            X = np.hstack([X_text, X_char, X_metadata_scaled])
            y = df['label'].values

            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y
            )

            # SMOTE oversampling
            try:
                from imblearn.over_sampling import SMOTE
                min_class = min(np.bincount(y_train))
                k = min(5, min_class - 1) if min_class > 1 else 1
                if k >= 1:
                    smote = SMOTE(random_state=42, k_neighbors=k)
                    X_train, y_train = smote.fit_resample(X_train, y_train)
                    logger.info(f"SMOTE: {dict(zip(*np.unique(y_train, return_counts=True)))}")
            except ImportError:
                logger.warning("imbalanced-learn not installed — skipping SMOTE")
            except Exception as e:
                logger.warning(f"SMOTE failed: {e}")

            # Train XGBoost
            try:
                import xgboost as xgb
                model = xgb.XGBClassifier(
                    n_estimators=400,
                    max_depth=5,
                    learning_rate=0.05,
                    objective='binary:logistic',
                    eval_metric='logloss',
                    random_state=42,
                    use_label_encoder=False,
                    scale_pos_weight=genuine_count / max(1, fake_count),
                    min_child_weight=2,
                    subsample=0.8,
                    colsample_bytree=0.7,
                    reg_alpha=0.1,
                    reg_lambda=1.5,
                    gamma=0.1,
                )
            except ImportError:
                from sklearn.ensemble import GradientBoostingClassifier
                model = GradientBoostingClassifier(
                    n_estimators=400, max_depth=5, learning_rate=0.05, random_state=42,
                )

            model.fit(X_train, y_train)

            y_pred = model.predict(X_test)
            y_proba = model.predict_proba(X_test)[:, 1]
            accuracy = accuracy_score(y_test, y_pred)
            f1 = f1_score(y_test, y_pred, average='weighted')
            try:
                auc = roc_auc_score(y_test, y_proba)
            except ValueError:
                auc = 0.0

            # Cross-validation
            cv_folds = min(5, min(np.bincount(y)) if min(np.bincount(y)) >= 2 else 2)
            if cv_folds >= 2:
                cv_scores = cross_val_score(model, X, y,
                                            cv=StratifiedKFold(cv_folds, shuffle=True, random_state=42),
                                            scoring='accuracy')
                logger.info(f"CV accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})")
            else:
                cv_scores = np.array([accuracy])

            logger.info(f"Fake detector trained: accuracy={accuracy:.4f}, F1={f1:.4f}, AUC={auc:.4f}")
            report = classification_report(y_test, y_pred, target_names=['genuine', 'suspicious'],
                                           output_dict=True, zero_division=0)

            # Save versioned artifacts
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            version = f'ml-fake-v3.0.0-{timestamp}'

            version_dir = MODEL_DIR / version
            version_dir.mkdir(parents=True, exist_ok=True)

            with open(version_dir / "fake_xgb_model.pkl", 'wb') as f:
                pickle.dump(model, f)
            with open(version_dir / "fake_tfidf.pkl", 'wb') as f:
                pickle.dump(vectorizer, f)
            with open(version_dir / "fake_char_tfidf.pkl", 'wb') as f:
                pickle.dump(char_vectorizer, f)
            with open(version_dir / "fake_scaler.pkl", 'wb') as f:
                pickle.dump(scaler, f)

            precision = precision_score(y_test, y_pred, average='weighted', zero_division=0)
            recall_val = recall_score(y_test, y_pred, average='weighted', zero_division=0)

            import hashlib as _hashlib
            dataset_hash = _hashlib.sha256(
                df['full_text'].str.cat(sep='|', na_rep='').encode()
            ).hexdigest()[:32]

            metrics = {
                'model_version': version,
                'accuracy': round(accuracy, 4),
                'precision': round(precision, 4),
                'recall': round(recall_val, 4),
                'f1_weighted': round(f1, 4),
                'auc_roc': round(auc, 4),
                'cv_accuracy_mean': round(float(cv_scores.mean()), 4),
                'cv_accuracy_std': round(float(cv_scores.std()), 4),
                'classification_report': report,
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'total_samples': len(df),
                'feature_count': X.shape[1],
                'text_features': X_text.shape[1],
                'char_features': X_char.shape[1],
                'metadata_features': X_metadata.shape[1],
                'genuine_count': int(genuine_count),
                'suspicious_count': int(fake_count),
                'dataset_hash': dataset_hash,
                'trained_at': datetime.utcnow().isoformat(),
            }
            with open(version_dir / "fake_metrics.json", 'w') as f:
                json.dump(metrics, f, indent=2, default=str)

            # Model Governance: register candidate & compare
            promoted = False
            try:
                from app.core.governance import governance
                await governance.register_candidate(
                    model_name="fake_detector",
                    version=version,
                    artifact_path=str(version_dir),
                    metrics=metrics,
                    dataset_size=len(df),
                    dataset_hash=dataset_hash,
                    feature_names=["text_len", "word_count", "avg_word_len", "special_char_ratio",
                                   "caps_ratio", "url_count", "exclamation_count", "spam_count",
                                   "disaster_count", "fake_count", "vague_count", "user_reputation",
                                   "image_count", "location_verified", "source_val",
                                   "submission_frequency", "similar_reports_count"],
                    training_config={"n_estimators": 150, "max_depth": 5, "lr": 0.1},
                )
                promotion = await governance.compare_and_promote(
                    model_name="fake_detector",
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
                with open(MODEL_DIR / "fake_tfidf.pkl", 'wb') as f:
                    pickle.dump(vectorizer, f)
                with open(MODEL_DIR / "fake_char_tfidf.pkl", 'wb') as f:
                    pickle.dump(char_vectorizer, f)
                with open(MODEL_DIR / "fake_scaler.pkl", 'wb') as f:
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
                logger.info(f"Keeping previous model — candidate {version} not promoted")

            return metrics

        finally:
            try:
                await conn.close()
            except Exception as e:
                logger.warning(f"Error closing DB connection: {e}")
