# AEGIS AI Engine - Training Pipeline

Complete machine learning training infrastructure for the AEGIS multi-hazard prediction system.

## Architecture Overview

```
app/training/
├── __init__.py                  # Module exports
├── data_loaders.py              # Data loading from PostgreSQL & external APIs
├── feature_engineering.py       # Advanced feature generation
├── training_pipeline.py         # End-to-end orchestration
├── experiment_tracker.py        # MLflow experiment tracking
├── hyperparameter_tuner.py      # Optuna-based optimization
├── model_trainer.py             # Unified model training interface
└── evaluator.py                 # Comprehensive evaluation metrics
```

## Features

### 1. Data Loaders
- **PostgreSQL Integration**: Load historical citizen reports with spatial filtering
- **Weather APIs**: Historical weather data time series
- **River Gauges**: SEPA flood sensor data
- **Data Validation**: Automatic quality checks (coordinate validation, null handling)

### 2. Feature Engineering
- **Rolling Statistics**: Moving averages, std dev, min/max over multiple windows
- **Lag Features**: Temporal dependencies (1h, 3h, 6h, 12h, 24h, 48h, 7d)
- **Interaction Terms**: Multiplicative and ratio features
- **Fourier Seasonal**: Daily, weekly, yearly patterns
- **Domain-Specific**: 
  - Flood: Cumulative rainfall, river level rate of change, saturation index
  - Drought: SPI components, evapotranspiration deficit
  - Heatwave: Temperature anomaly, consecutive hot days, heat index

### 3. Model Training
Supports multiple model architectures:
- **XGBoost**: Gradient boosting with tree-based learners
- **LightGBM**: Fast gradient boosting
- **CatBoost**: Handling categorical features natively
- **Random Forest**: Ensemble of decision trees
- **LSTM** (PyTorch): Deep learning for time series

### 4. Hyperparameter Tuning
- **Optuna Integration**: Bayesian optimization
- **Pruning**: Stop underperforming trials early
- **Multi-objective**: Optimize multiple metrics simultaneously
- **Model-Specific Search Spaces**: Pre-configured for each algorithm

### 5. Evaluation
Comprehensive metrics per config.yaml:

**Classification**:
- Accuracy, Precision, Recall, F1-score
- ROC AUC, PR AUC
- Brier score, Log loss
- False Alarm Rate, Miss Rate

**Regression**:
- MAE, RMSE, MAPE, R²

**Probabilistic**:
- Calibration error (ECE)
- Reliability diagrams

**Explainability**:
- Feature importance
- SHAP values (TreeExplainer)

### 6. Experiment Tracking
- **MLflow Integration**: Track all experiments
- **Versioning**: Automatic model versioning
- **Artifacts**: Models, plots, feature importance
- **Comparison**: Compare runs by metrics

## Usage

### Basic Training

```python
import asyncio
from datetime import datetime, timedelta
from app.training import TrainingPipeline

async def train_flood_model():
    pipeline = TrainingPipeline("config.yaml")
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=90)
    
    results = await pipeline.train_model(
        hazard_type='flood',
        model_type='xgboost',
        start_date=start_date,
        end_date=end_date,
        tune_hyperparams=True,
        save_model=True
    )
    
    print(f"Training complete!")
    print(f"Metrics: {results['metrics']}")
    print(f"Model saved to: {results['model_path']}")

# Run
asyncio.run(train_flood_model())
```

### Train All Models for a Hazard

```python
async def train_all_flood_models():
    pipeline = TrainingPipeline("config.yaml")
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=90)
    
    results = await pipeline.train_all_models(
        hazard_type='flood',
        start_date=start_date,
        end_date=end_date
    )
    
    # Compare models
    comparison = pipeline.compare_model_results(results)
    print(comparison)

asyncio.run(train_all_flood_models())
```

### Custom Feature Engineering

```python
from app.training import FeatureEngineer
import pandas as pd

engineer = FeatureEngineer("config.yaml")

# Your raw data
df = pd.read_csv("raw_data.csv")

# Engineer all features
df_engineered = engineer.engineer_all_features(
    df=df,
    hazard_type='flood',
    timestamp_col='timestamp'
)

print(f"Original features: {len(df.columns)}")
print(f"Engineered features: {len(df_engineered.columns)}")
```

### Hyperparameter Tuning Only

```python
from app.training import HyperparameterTuner

tuner = HyperparameterTuner("config.yaml")

def objective(trial):
    params = tuner.suggest_xgboost_params(trial)
    # Train and evaluate model with params
    # Return metric value
    return metric_value

study = tuner.optimize(
    objective_fn=objective,
    model_type='xgboost',
    direction='maximize',
    n_trials=100
)

best_params = tuner.get_best_params(study, 'xgboost')
```

### Model Evaluation

```python
from app.training import ModelEvaluator
import numpy as np

evaluator = ModelEvaluator("config.yaml")

# Your predictions
y_true = np.array([0, 1, 1, 0, 1])
y_pred = np.array([0, 1, 1, 1, 1])
y_prob = np.array([0.1, 0.9, 0.8, 0.6, 0.95])

# Evaluate
metrics = evaluator.evaluate_classification(y_true, y_pred, y_prob)
print(metrics)

# Generate report
report = evaluator.generate_evaluation_report(
    y_true=y_true,
    y_pred=y_pred,
    y_prob=y_prob,
    task='classification'
)
```

## Configuration

Training behavior is controlled by `config.yaml`:

```yaml
training:
  reproducibility:
    random_seed: 42
    deterministic_mode: true

  validation:
    strategy: "time_series_split"
    n_splits: 5
    test_size: 0.2

  hyperparameter_tuning:
    enabled: true
    method: "optuna"
    n_trials: 100
    timeout: 3600

  feature_engineering:
    auto_generate: true
    methods:
      - rolling_statistics
      - lag_features
      - interaction_terms
      - fourier_seasonal
```

## MLflow UI

View experiments:

```bash
cd ai-engine
mlflow ui --backend-store-uri file:./mlruns
```

Navigate to http://localhost:5000

## Model Registry

Trained models are saved to:

```
model_registry/
├── flood/
│   ├── xgboost/
│   │   └── model_20260303_120000.pkl
│   ├── lightgbm/
│   └── random_forest/
├── drought/
└── heatwave/
```

## Requirements

Core dependencies:
- `scikit-learn>=1.3.2`
- `xgboost>=2.0.2`
- `lightgbm>=4.1.0`
- `catboost>=1.2.2`
- `mlflow>=2.9.2`
- `optuna>=3.4.0`
- `torch>=2.1.1` (optional, for LSTM)
- `shap>=0.43.0` (optional, for explainability)

## Best Practices

1. **Always use time series split** for temporal data validation
2. **Enable hyperparameter tuning** for production models
3. **Track all experiments** with MLflow
4. **Monitor feature importance** to avoid feature leakage
5. **Evaluate calibration** for probabilistic predictions
6. **Save model metadata** alongside artifacts

## Troubleshooting

**Issue**: "No data returned from database"
- Check `DATABASE_URL` in `.env`
- Verify reports exist in date range
- Check database connection with `psql`

**Issue**: "SHAP calculation failed"
- Install SHAP: `pip install shap`
- Reduce `max_samples` parameter for large datasets

**Issue**: "MLflow tracking URI not found"
- MLflow automatically creates `./mlruns` directory
- Check write permissions

## Next Steps

1. Integrate with real weather APIs (Met Office, ECMWF)
2. Add SEPA river gauge integration
3. Implement model serving endpoint
4. Set up automated retraining pipeline
5. Add drift detection monitoring


**For production deployment**, see main AEGIS documentation.

