"""
 AEGIS AI ENGINE — Real ML Fake Report Detector  
 XGBoost trained on report metadata + text features from PostgreSQL

Training pipeline:
  1. Fetch reports from PostgreSQL
  2. Engineer features: text quality, trust score, frequency patterns, metadata
  3. Auto-label based on reporter_scores and verified status
  4. Train XGBoost binary classifier (real vs suspicious)
  5. Save model + metrics to model_registry/fake_detector/
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
        if mp.exists():
            try:
                with open(mp, 'rb') as f:
                    self.model = pickle.load(f)
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
        """Extract numeric features from report data."""
        full_text = f"{text} {description}".lower()

        # Text quality features
        text_len = len(full_text)
        word_count = len(full_text.split())
        avg_word_len = np.mean([len(w) for w in full_text.split()]) if word_count > 0 else 0
        special_char_ratio = len(re.findall(r'[^a-zA-Z0-9\s]', full_text)) / max(1, text_len)
        caps_ratio = len(re.findall(r'[A-Z]', text + description)) / max(1, len(text + description))
        url_count = len(re.findall(r'http[s]?://', full_text))
        exclamation_count = full_text.count('!')

        # Spam indicator keywords
        spam_words = ['buy', 'sell', 'cheap', 'discount', 'offer', 'click', 'free', 'win', 'prize', 'lottery']
        spam_count = sum(1 for w in spam_words if w in full_text)

        # Disaster relevance keywords
        disaster_words = ['flood', 'water', 'rain', 'storm', 'damage', 'emergency', 'evacuate',
                          'rescue', 'destroyed', 'collapsed', 'injured', 'trapped']
        disaster_count = sum(1 for w in disaster_words if w in full_text)

        # Fake indicator keywords
        fake_words = ['hoax', 'rumor', 'prank', 'joke', 'fake', 'allegedly', 'supposedly']
        fake_count = sum(1 for w in fake_words if w in full_text)

        # Vague keywords
        vague_words = ['something', 'maybe', 'i think', 'not sure', 'probably', 'someone said']
        vague_count = sum(1 for w in vague_words if w in full_text)

        # Source encoding
        source_map = {'official': 0, 'verified_user': 1, 'user_report': 2, 'social_media': 3, 'anonymous': 4}
        source_val = source_map.get(source_type, 2)

        return np.array([
            text_len,
            word_count,
            avg_word_len,
            special_char_ratio,
            caps_ratio,
            url_count,
            exclamation_count,
            spam_count,
            disaster_count,
            fake_count,
            vague_count,
            user_reputation,
            image_count,
            1 if location_verified else 0,
            source_val,
            submission_frequency,
            similar_reports_count,
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
        features = self._extract_features(
            text, description, user_reputation, image_count,
            location_verified, source_type, submission_frequency, similar_reports_count
        )

        if self.model is not None:
            return self._ml_detect(features)
        else:
            return self._rule_detect(features, text, description, user_reputation)

    def _ml_detect(self, features: np.ndarray) -> Dict[str, Any]:
        """ML-based detection."""
        try:
            X = features.reshape(1, -1)
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
                'confidence': round(float(np.max(y_proba)), 4),
                'recommended_action': action,
                'trained': True,
                'detected_at': datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"ML fake detection error: {e}")
            return self._rule_detect(features, "", "", 0.5)

    def _rule_detect(self, features: np.ndarray, text: str, description: str, reputation: float) -> Dict[str, Any]:
        """Rule-based fallback — clearly marked as heuristic."""
        full_text = f"{text} {description}".lower()
        score = 0.0
        flags = []

        if len(full_text) < 20:
            score += 20; flags.append("text_too_short")
        if features[7] > 0:  # spam_count
            score += features[7] * 10; flags.append("spam_keywords")
        if features[9] > 0:  # fake_count
            score += features[9] * 15; flags.append("fake_indicators")
        if reputation < 0.3:
            score += 15; flags.append("low_reputation")
        if features[5] > 0:  # url_count
            score += 10; flags.append("contains_urls")

        fake_prob = min(1.0, score / 100.0)

        if fake_prob >= 0.75:
            classification = 'likely_fake'
        elif fake_prob >= 0.50:
            classification = 'suspicious'
        elif fake_prob >= 0.25:
            classification = 'questionable'
        else:
            classification = 'genuine'

        return {
            'model_version': 'rule-fallback-v1',
            'is_fake': fake_prob > 0.5,
            'fake_probability': round(fake_prob, 4),
            'classification': classification,
            'confidence': round(0.6, 4),
            'recommended_action': 'accept' if fake_prob < 0.5 else 'flag_for_review',
            'red_flags': flags,
            'trained': False,
            'detected_at': datetime.utcnow().isoformat()
        }

    def train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train fake detector on real reports from PostgreSQL (sync wrapper)."""
        import asyncio
        try:
            loop = asyncio.get_running_loop()
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self._train_async(db_url))
                return future.result(timeout=300)
        except RuntimeError:
            return asyncio.run(self._train_async(db_url))

    async def async_train(self, db_url: str = DB_URL) -> Dict[str, Any]:
        """Train fake detector (async — call from within running event loop)."""
        return await self._train_async(db_url)

    async def _train_async(self, db_url: str) -> Dict[str, Any]:
        import asyncpg
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import accuracy_score, f1_score, classification_report, roc_auc_score

        logger.info("Starting fake detector training...")
        conn = await asyncpg.connect(db_url)

        try:
            # Get reports with trust signals for auto-labeling
            rows = await conn.fetch("""
                SELECT r.display_type, r.description, r.incident_category, r.severity,
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

            # Convert Decimal columns to float (asyncpg returns numeric as Decimal)
            for col in ['trust_score', 'ai_confidence']:
                if col in df.columns:
                    df[col] = df[col].astype(float)

            # Auto-label based on trust signals
            # trust_score is numeric(5,4) so 0-1 range
            df['label'] = 0  # default: genuine

            # Mark suspicious reports
            suspicious_mask = (
                (df['trust_score'] < 0.25) |
                ((df['trust_score'] < 0.40) & (df['verified_reports'] == 0)) |
                (df['description'].str.len() < 15) |
                df['description'].apply(lambda t: bool(re.search(r'http[s]?://', str(t).lower())))
            )
            df.loc[suspicious_mask, 'label'] = 1  # suspicious/fake

            genuine_count = (df['label'] == 0).sum()
            fake_count = (df['label'] == 1).sum()
            logger.info(f"Auto-labeled: {genuine_count} genuine, {fake_count} suspicious")

            if fake_count < 10:
                # If too few suspicious, use text quality heuristics to find candidates
                df['text_quality'] = (
                    df['description'].str.len() / df['description'].str.len().max()
                    + df['trust_score']
                    + df['has_media'].astype(float) * 0.2
                )
                low_quality = df.nsmallest(max(50, len(df) // 8), 'text_quality')
                df.loc[low_quality.index, 'label'] = 1
                fake_count = (df['label'] == 1).sum()
                logger.info(f"Augmented: now {fake_count} suspicious samples")

            # Feature engineering
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

            X = np.array(features)
            y = df['label'].values

            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y
            )

            # Train
            try:
                import xgboost as xgb
                model = xgb.XGBClassifier(
                    n_estimators=150,
                    max_depth=5,
                    learning_rate=0.1,
                    objective='binary:logistic',
                    eval_metric='logloss',
                    random_state=42,
                    use_label_encoder=False,
                    scale_pos_weight=genuine_count / max(1, fake_count),
                )
            except ImportError:
                from sklearn.ensemble import GradientBoostingClassifier
                model = GradientBoostingClassifier(
                    n_estimators=150, max_depth=5, learning_rate=0.1, random_state=42,
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

            logger.info(f"Fake detector trained: accuracy={accuracy:.4f}, F1={f1:.4f}, AUC={auc:.4f}")
            report = classification_report(y_test, y_pred, target_names=['genuine', 'suspicious'], output_dict=True, zero_division=0)

            # Save versioned artifacts (always save to version dir for audit)
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            version = f'ml-fake-v2.0.0-{timestamp}'

            version_dir = MODEL_DIR / version
            version_dir.mkdir(parents=True, exist_ok=True)

            with open(version_dir / "fake_xgb_model.pkl", 'wb') as f:
                pickle.dump(model, f)

            from sklearn.metrics import precision_score, recall_score
            precision = precision_score(y_test, y_pred, average='weighted', zero_division=0)
            recall_val = recall_score(y_test, y_pred, average='weighted', zero_division=0)

            import hashlib as _hashlib
            dataset_hash = _hashlib.sha256(
                df['description'].str.cat(sep='|', na_rep='').encode()
            ).hexdigest()[:32]

            metrics = {
                'model_version': version,
                'accuracy': round(accuracy, 4),
                'precision': round(precision, 4),
                'recall': round(recall_val, 4),
                'f1_weighted': round(f1, 4),
                'auc_roc': round(auc, 4),
                'classification_report': report,
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'total_samples': len(df),
                'feature_count': X.shape[1],
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
                with open(self._metrics_path(), 'w') as f:
                    json.dump(metrics, f, indent=2, default=str)
                self.model = model
                self.model_version = version
                self.training_metrics = metrics
                logger.info(f"Active model updated to {version}")
            else:
                logger.info(f"Keeping previous model — candidate {version} not promoted")

            return metrics

        finally:
            await conn.close()
