"""
Retrain all hazard models with grid-searched hyperparameters - v3 fixed API.
"""
import asyncio
import sys
import os
import time
import warnings
import numpy as np
warnings.filterwarnings('ignore')

sys.path.insert(0, r'e:\aegis-v6-fullstack\aegis-v6\ai-engine')
os.chdir(r'e:\aegis-v6-fullstack\aegis-v6\ai-engine')

DB_URL = 'postgresql://postgres:Happylove%40%21@localhost:5432/aegis'

async def train_hazard(hazard_type: str):
    from app.training.data_loaders import DataLoader
    from app.training.feature_engineering import FeatureEngineer
    import asyncpg
    import pandas as pd
    from sklearn.model_selection import train_test_split
    from xgboost import XGBClassifier
    from sklearn.metrics import accuracy_score, roc_auc_score, f1_score, precision_score, recall_score
    
    print(f"\n{'='*60}")
    print(f"  TRAINING: {hazard_type.upper()} (grid search)")
    print(f"{'='*60}")
    
    start = time.time()
    
    loader = DataLoader()
    loader.db_pool = await asyncpg.create_pool(
        dsn=DB_URL, min_size=2, max_size=5, command_timeout=60
    )
    
    try:
        # Load data using correct API
        features_df, labels_df = await loader.create_training_dataset(
            hazard_type=hazard_type,
            lookback_days=365,
        )
        
        print(f"  Loaded {len(features_df)} samples")
        print(f"  Target: {dict(labels_df['target'].value_counts())}")
        
        # Prepare features
        X = features_df.select_dtypes(include=[np.number]).copy()
        for col in ['timestamp']:
            if col in X.columns:
                X = X.drop(columns=[col])
        y = labels_df['target'].values
        
        # Engineer features
        fe = FeatureEngineer()
        X = fe.engineer_all_features(X, hazard_type)
        
        # Encode categoricals
        for col in X.columns:
            if X[col].dtype == 'object':
                X[col] = pd.Categorical(X[col]).codes
        X = X.fillna(0)
        
        # Stratified split
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        print(f"  Train: {len(X_train)} ({sum(y_train)} pos)")
        print(f"  Val:   {len(X_val)} ({sum(y_val)} pos)")
        
        # Grid search
        best_score = 0
        best_model = None
        best_metrics = {}
        best_params = {}
        
        param_grid = [
            {'n_estimators': 100, 'max_depth': 3, 'learning_rate': 0.1, 'min_child_weight': 1, 'subsample': 0.8, 'colsample_bytree': 0.8},
            {'n_estimators': 200, 'max_depth': 4, 'learning_rate': 0.05, 'min_child_weight': 2, 'subsample': 0.85, 'colsample_bytree': 0.85},
            {'n_estimators': 300, 'max_depth': 5, 'learning_rate': 0.03, 'min_child_weight': 1, 'subsample': 0.9, 'colsample_bytree': 0.9},
            {'n_estimators': 150, 'max_depth': 6, 'learning_rate': 0.08, 'min_child_weight': 3, 'subsample': 0.8, 'colsample_bytree': 0.7},
            {'n_estimators': 250, 'max_depth': 4, 'learning_rate': 0.05, 'min_child_weight': 1, 'subsample': 0.75, 'colsample_bytree': 0.8},
            {'n_estimators': 500, 'max_depth': 3, 'learning_rate': 0.02, 'min_child_weight': 2, 'subsample': 0.85, 'colsample_bytree': 0.85},
            {'n_estimators': 200, 'max_depth': 7, 'learning_rate': 0.1, 'min_child_weight': 5, 'subsample': 0.7, 'colsample_bytree': 0.6},
            {'n_estimators': 300, 'max_depth': 5, 'learning_rate': 0.05, 'min_child_weight': 3, 'subsample': 0.85, 'colsample_bytree': 0.75},
            {'n_estimators': 400, 'max_depth': 4, 'learning_rate': 0.03, 'min_child_weight': 1, 'subsample': 0.9, 'colsample_bytree': 0.85},
            {'n_estimators': 150, 'max_depth': 5, 'learning_rate': 0.1, 'min_child_weight': 2, 'subsample': 0.85, 'colsample_bytree': 0.8},
        ]
        
        print(f"\n  Grid searching {len(param_grid)} configurations...")
        
        for i, params in enumerate(param_grid):
            model = XGBClassifier(
                **params,
                gamma=0.1,
                reg_alpha=0.1,
                reg_lambda=1.0,
                use_label_encoder=False,
                eval_metric='logloss',
                random_state=42,
                verbosity=0,
            )
            
            model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
            
            y_pred = model.predict(X_val)
            y_prob = model.predict_proba(X_val)[:, 1]
            
            acc = accuracy_score(y_val, y_pred)
            auc = roc_auc_score(y_val, y_prob)
            f1 = f1_score(y_val, y_pred)
            
            score = 0.3 * acc + 0.4 * auc + 0.3 * f1
            
            marker = ''
            if score > best_score:
                best_score = score
                best_params = params
                best_model = model
                best_metrics = {
                    'accuracy': acc, 'roc_auc': auc, 'f1_score': f1,
                    'precision': precision_score(y_val, y_pred),
                    'recall': recall_score(y_val, y_pred),
                }
                marker = ' ★'
            
            print(f"    [{i+1:2d}] acc={acc:.3f} auc={auc:.3f} f1={f1:.3f}{marker}")
        
        print(f"\n  ★ Best: acc={best_metrics['accuracy']:.1%} auc={best_metrics['roc_auc']:.3f} f1={best_metrics['f1_score']:.3f}")
        print(f"    params: depth={best_params['max_depth']} lr={best_params['learning_rate']} n={best_params['n_estimators']}")
        
        # Save model
        import pickle
        model_dir = os.path.join('model_registry', hazard_type, 'xgboost')
        os.makedirs(model_dir, exist_ok=True)
        ts_str = time.strftime('%Y%m%d_%H%M%S')
        model_path = os.path.join(model_dir, f'model_{ts_str}.pkl')
        
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': best_model,
                'feature_names': list(X.columns),
                'params': best_params,
                'metrics': best_metrics,
                'hazard_type': hazard_type,
                'training_samples': len(X_train),
            }, f)
        
        # Save metrics to DB
        pool = await asyncpg.create_pool(dsn=DB_URL, min_size=1, max_size=2, command_timeout=60)
        async with pool.acquire() as conn:
            for mn, mv in best_metrics.items():
                await conn.execute(
                    "INSERT INTO ai_model_metrics (model_name, model_version, metric_name, metric_value, dataset_size, evaluated_at) VALUES ($1, $2, $3, $4, $5, NOW())",
                    f'{hazard_type}_xgboost', f'grid-{ts_str}', mn, float(mv), len(X_train))
        await pool.close()
        
        elapsed = time.time() - start
        print(f"  Saved: {model_path} ({elapsed:.1f}s)")
        
        return best_metrics
        
    except Exception as e:
        print(f"\n  FAILED: {hazard_type} - {e}")
        import traceback
        traceback.print_exc()
        return {'error': str(e)}
    finally:
        if loader.db_pool:
            await loader.db_pool.close()

async def main():
    print("AEGIS Hazard Retraining v3 - Grid Search + Label-Aware Weather")
    print("=" * 60)
    
    results = {}
    for hazard in ['flood', 'drought', 'heatwave']:
        results[hazard] = await train_hazard(hazard)
    
    print(f"\n\n{'='*60}")
    print("  FINAL SUMMARY")
    print(f"{'='*60}")
    for h, r in results.items():
        if 'error' in r:
            print(f"  {h:15s} FAILED: {r['error']}")
        else:
            print(f"  {h:15s} acc={r['accuracy']:.1%}  auc={r['roc_auc']:.3f}  f1={r['f1_score']:.3f}  prec={r['precision']:.3f}  recall={r['recall']:.3f}")

asyncio.run(main())
