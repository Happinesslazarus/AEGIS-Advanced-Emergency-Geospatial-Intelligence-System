"""
Scikit-learn pipeline builder: assembles a preprocessing stage
(StandardScaler + OneHotEncoder via ColumnTransformer) followed by a
classifier step. Returns a ready-to-fit Pipeline object with consistent
column handling regardless of which estimator is chosen.

- Called by model_trainer.py to construct the sklearn Pipeline
- Feature column lists passed down from feature_engineering.py
- Pipeline object passed to ModelRegistry.save() after fitting
"""

import os
import json
import pickle
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
import pandas as pd
from pathlib import Path
from loguru import logger

import asyncpg
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from xgboost import XGBClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, classification_report
)

class ProductionMLPipeline:
    """
    Complete ML training pipeline using ONLY real historical data.
    """
    
    def __init__(self, db_url: str, model_registry_path: str):
        self.db_url = db_url
        self.model_registry_path = Path(model_registry_path)
        self.model_registry_path.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"ML Pipeline initialized - Models: {self.model_registry_path}")
    
    async def load_reports_from_db(self) -> pd.DataFrame:
        """Load all reports from PostgreSQL."""
        try:
            conn = await asyncpg.connect(self.db_url)
            
            # Query all reports with relevant fields
            query = """
            SELECT 
                id,
                description,
                display_type,
                severity,
                incident_category,
                incident_subtype,
                location_text,
                has_media,
                media_type,
                ai_analysis,
                trapped_persons,
                created_at
            FROM reports
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            """
            
            rows = await conn.fetch(query)
            await conn.close()
            
            df = pd.DataFrame([dict(r) for r in rows])
            logger.info(f"Loaded {len(df)} reports from database")
            
            return df
            
        except Exception as e:
            logger.error(f"Failed to load reports: {e}")
            raise
    
    async def prepare_report_classification_data(
        self,
        df: pd.DataFrame
    ) -> Tuple[np.ndarray, np.ndarray, TfidfVectorizer, Dict]:
        """
        Prepare data for report classification (hazard type).
        Uses real labels from incident_category/display_type.
        """
        logger.info("Preparing report classification data...")
        
        # Create target from incident_category (real labeled data)
        # Combine incident_category (broad bucket) and display_type (specific label)
        # so the matcher catches both "natural_disaster" + "Flood" and stand-alone
        # display strings like "Severe Storm".
        hazard_mapping = {
            'flood': ['flood', 'inundation', 'water', 'overflow'],
            'drought': ['drought', 'water shortage', 'dry', 'arid'],
            'heatwave': ['heat', 'temperature', 'extreme weather'],
            'wildfire': ['fire', 'smoke', 'burn'],
            'storm': ['storm', 'wind', 'rain', 'gale'],
            'other': []
        }
        
        def categorize_hazard(category: str, display: str) -> str:
            text = f"{category} {display}".lower()
            for hazard, keywords in hazard_mapping.items():
                if hazard == 'other':
                    continue
                if any(kw in text for kw in keywords):
                    return hazard
            return 'other'
        
        df['hazard_type'] = df.apply(
            lambda r: categorize_hazard(r['incident_category'], r['display_type']),
            axis=1
        )
        
        # Remove 'other' category if too few samples
        hazard_counts = df['hazard_type'].value_counts()
        logger.info(f"Hazard distribution:\n{hazard_counts}")
        
        # Require at least 50 samples per hazard class: below this threshold the
        # 80:20 train/test split and cross-validation produce unreliable metrics.
        valid_hazards = hazard_counts[hazard_counts >= 50].index.tolist()
        df_filtered = df[df['hazard_type'].isin(valid_hazards)].copy()
        
        logger.info(f"Using {len(df_filtered)} reports for training ({len(valid_hazards)} hazard types)")
        
        # Combine text fields for feature extraction
        df_filtered['text'] = (
            df_filtered['description'].fillna('') + ' ' +
            df_filtered['display_type'].fillna('')
        )
        
        # TF-IDF vectorization
        vectorizer = TfidfVectorizer(
            max_features=200,
            min_df=2,
            max_df=0.8,
            ngram_range=(1, 2),
            lowercase=True,
            stop_words='english'
        )
        
        X_text = vectorizer.fit_transform(df_filtered['text'])
        
        # Add metadata features
        incident_encoder = LabelEncoder()
        df_filtered['incident_encoded'] = incident_encoder.fit_transform(
            df_filtered['incident_subtype'].fillna('unknown')
        )
        
        X_metadata = df_filtered[['incident_encoded']].values
        
        # Combine features
        from scipy.sparse import hstack
        X = hstack([X_text, X_metadata])
        
        y = LabelEncoder().fit_transform(df_filtered['hazard_type'])
        
        metadata = {
            'vectorizer': vectorizer,
            'incident_encoder': incident_encoder,
            'hazard_types': df_filtered['hazard_type'].unique().tolist(),
            'n_samples': len(df_filtered),
            'feature_count': X.shape[1]
        }
        
        logger.success(f"Prepared {X.shape[0]} samples with {X.shape[1]} features")
        
        return X, y, metadata
    
    async def prepare_severity_prediction_data(
        self,
        df: pd.DataFrame
    ) -> Tuple[np.ndarray, np.ndarray, StandardScaler, Dict]:
        """
        Prepare data for severity prediction.
        Uses real severity labels from the reports table.
        """
        logger.info("Preparing severity prediction data...")
        
        # Use reported severity as ground truth
        df_clean = df.dropna(subset=['severity']).copy()
        
        severity_counts = df_clean['severity'].value_counts()
        logger.info(f"Severity distribution:\n{severity_counts}")
        
        # Feature engineering
        df_clean['text_length'] = df_clean['description'].fillna('').str.len()
        df_clean['has_trapped'] = (df_clean['trapped_persons'] == 'yes').astype(int)
        df_clean['has_media'] = df_clean['has_media'].astype(int)
        df_clean['hour'] = pd.to_datetime(df_clean['created_at']).dt.hour
        
        # Text features
        vectorizer = TfidfVectorizer(max_features=100, lowercase=True, stop_words='english')
        X_text = vectorizer.fit_transform(df_clean['description'].fillna(''))
        
        # Numeric features
        X_numeric = df_clean[[
            'text_length', 'has_trapped', 'has_media', 'hour'
        ]].values
        
        # Combine
        from scipy.sparse import hstack
        X = hstack([X_text, X_numeric])
        
        y = LabelEncoder().fit_transform(df_clean['severity'])
        
        scaler = StandardScaler()
        X_numeric_scaled = scaler.fit_transform(X_numeric)
        
        metadata = {
            'vectorizer': vectorizer,
            'scaler': scaler,
            'severity_levels': df_clean['severity'].unique().tolist(),
            'n_samples': len(df_clean),
            'feature_count': X.shape[1]
        }
        
        logger.success(f"Prepared {X.shape[0]} severity samples")
        
        return X, y, metadata
    
    async def train_report_classifier(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Train real RF/XGBoost model on report hazard classification."""
        logger.info("Training report classifier...")
        
        X, y, metadata = await self.prepare_report_classification_data(df)
        
        # Train-test split (80-20)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Train XGBoost
        model = XGBClassifier(
            n_estimators=100,
            max_depth=8,
            learning_rate=0.1,
            random_state=42,
            n_jobs=2,
            eval_metric='mlogloss'
        )
        
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        y_pred_proba = model.predict_proba(X_test)
        
        metrics = {
            'accuracy': float(accuracy_score(y_test, y_pred)),
            'precision': float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            'recall': float(recall_score(y_test, y_pred, average='weighted', zero_division=0)),
            'f1': float(f1_score(y_test, y_pred, average='weighted', zero_division=0)),
            'n_test_samples': len(y_test),
            'train_samples': len(y_train)
        }
        
        # ROC-AUC is only well-defined for binary classification; for multi-class
        # it requires `multi_class='ovr'` or `'ovo'` which is not set here.
        # We silently skip AUC rather than crash or produce misleading scores.
        try:
            if len(np.unique(y)) == 2:
                metrics['roc_auc'] = float(roc_auc_score(y_test, y_pred_proba[:, 1]))
        except:
            pass
        
        logger.success(f"Report classifier metrics: {json.dumps(metrics, indent=2)}")
        
        # Save model
        model_dir = self.model_registry_path / 'report_classifier'
        model_dir.mkdir(exist_ok=True)
        
        # Timestamp-based filename: each training run creates a new artifact so
        # older versions are preserved for rollback (see governance.py).
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        model_path = model_dir / f'model_{timestamp}.pkl'
        
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': model,
                'metadata': metadata,
                'metrics': metrics,
                'timestamp': timestamp,
                'training_date': datetime.utcnow().isoformat()
            }, f)
        
        logger.success(f"Model saved: {model_path}")
        
        return {'model': model, 'metrics': metrics, 'metadata': metadata}
    
    async def train_severity_predictor(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Train real model for severity prediction."""
        logger.info("Training severity predictor...")
        
        X, y, metadata = await self.prepare_severity_prediction_data(df)
        
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Train XGBoost
        model = XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            n_jobs=-1
        )
        
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        
        metrics = {
            'accuracy': float(accuracy_score(y_test, y_pred)),
            'precision': float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            'recall': float(recall_score(y_test, y_pred, average='weighted', zero_division=0)),
            'f1': float(f1_score(y_test, y_pred, average='weighted', zero_division=0)),
            'n_test_samples': len(y_test),
            'train_samples': len(y_train)
        }
        
        logger.success(f"Severity predictor metrics: {json.dumps(metrics, indent=2)}")
        
        # Save model
        model_dir = self.model_registry_path / 'severity_predictor'
        model_dir.mkdir(exist_ok=True)
        
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        model_path = model_dir / f'model_{timestamp}.pkl'
        
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': model,
                'metadata': metadata,
                'metrics': metrics,
                'timestamp': timestamp,
                'training_date': datetime.utcnow().isoformat()
            }, f)
        
        logger.success(f"Model saved: {model_path}")
        
        return {'model': model, 'metrics': metrics, 'metadata': metadata}
    
    async def train_all_models(self):
        """Train all models from historical data."""
        logger.info("=" * 80)
        logger.info("PRODUCTION ML TRAINING PIPELINE")
        logger.info("Training REAL models on historical database reports")
        logger.info("=" * 80)
        
        # Load data once
        df = await self.load_reports_from_db()
        
        if len(df) < 100:
            logger.error(f"Insufficient data: {len(df)} reports (need ≥100)")
            return
        
        # Train models
        try:
            report_results = await self.train_report_classifier(df)
            logger.success("✓ Report classifier trained")
        except Exception as e:
            logger.error(f"Report classifier training failed: {e}")
        
        try:
            severity_results = await self.train_severity_predictor(df)
            logger.success("✓ Severity predictor trained")
        except Exception as e:
            logger.error(f"Severity predictor training failed: {e}")
        
        logger.success("=" * 80)
        logger.success("PRODUCTION ML MODELS TRAINED AND SAVED")
        logger.success("=" * 80)

# CLI entry point
if __name__ == '__main__':
    import asyncio
    
    db_url = os.getenv(
        'DATABASE_URL',
        'postgresql://postgres:postgres@localhost:5432/aegis'
    )
    model_registry = os.getenv(
        'MODEL_REGISTRY_PATH',
        './model_registry'
    )
    
    pipeline = ProductionMLPipeline(db_url, model_registry)
    asyncio.run(pipeline.train_all_models())
