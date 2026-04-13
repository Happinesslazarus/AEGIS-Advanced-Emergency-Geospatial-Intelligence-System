# AEGIS AI Engine

FastAPI-based multi-hazard prediction engine for the AEGIS emergency management platform. Provides REST endpoints for flood, drought, heatwave, wildfire, landslide, earthquake, storm, tsunami, volcanic, and avalanche predictions.

Runs on port **8000** (internal to the Docker network). The Node.js server calls this service; it is **not** directly reachable from the browser in production.

---

## Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Python | 3.11 | `python --version` |
| pip | 23+ | PyTorch + scikit-learn wheels |
| RAM | 4 GB free | LLMs require more — see Ollama docs |
| Disk | 2 GB | Model registry + feature store |

---

## Quick Start

```bash
cd aegis-v6/ai-engine

python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env           # fill in API_KEY_SECRET and DB URL

python main.py                 # starts on http://localhost:8000
```

Interactive API docs at `http://localhost:8000/docs`.

---

## Module Structure

```
ai-engine/
├── main.py                    # FastAPI app init, middleware, startup
├── config.yaml                # Master config: model paths, thresholds, providers
├── requirements.txt           # Pinned dependencies
├── Dockerfile                 # Production-ready container
│
├── app/
│   ├── api/
│   │   └── endpoints.py       # All 10 hazard endpoint handlers + /health /metrics
│   │
│   ├── core/
│   │   ├── registry.py        # Model registry: load, version, rollback
│   │   └── features.py        # Universal feature schema + normalisers
│   │
│   ├── hazards/               # One module per hazard type
│   │   ├── flood.py           # LSTM + XGBoost ensemble, SHAP, physics fallback
│   │   ├── drought.py
│   │   ├── heatwave.py
│   │   ├── wildfire.py
│   │   ├── landslide.py
│   │   ├── earthquake.py
│   │   ├── storm.py
│   │   ├── tsunami.py
│   │   ├── volcanic.py
│   │   └── avalanche.py
│   │
│   ├── training/
│   │   ├── training_pipeline.py     # 8-step orchestrator
│   │   ├── model_trainer.py         # Cross-validation, early stopping
│   │   ├── evaluator.py             # Metrics, confusion matrix, SHAP summaries
│   │   ├── experiment_tracker.py    # MLflow-compatible experiment logging
│   │   ├── hyperparameter_tuner.py  # Optuna Bayesian search
│   │   └── data_preprocessor.py    # Missing value imputation, scaling
│   │
│   ├── monitoring/
│   │   ├── drift_detector.py        # PSI + KS-test feature drift monitoring
│   │   ├── performance_tracker.py   # Rolling accuracy metrics on live predictions
│   │   └── alerting.py              # Drift + degradation alerts
│   │
│   └── schemas/               # Pydantic request/response models
│
├── model_registry/            # Serialised models (joblib / PyTorch state dicts)
├── feature_store/             # Cached feature vectors (parquet)
├── data/                      # Training datasets (gitignored)
├── logs/                      # Structured JSON logs (gitignored)
├── reports/                   # Evaluation reports, confusion matrices
└── tests/                     # pytest suite
```

---

## Authentication

All prediction endpoints require the `X-API-Key` header. The key must match `API_KEY_SECRET` in `.env`. See `app/api/endpoints.py` for implementation.

The `/health` endpoint has no authentication.

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Returns `{"status":"healthy"}` |
| GET | `/metrics` | None | Prometheus counters for predictions + latency |
| POST | `/api/predict/flood` | API key | Flood probability + affected area |
| POST | `/api/predict/drought` | API key | Drought onset probability |
| POST | `/api/predict/heatwave` | API key | Heatwave risk + duration estimate |
| POST | `/api/predict/wildfire` | API key | Fire weather index + spread risk |
| POST | `/api/predict/landslide` | API key | Mass movement probability |
| POST | `/api/predict/earthquake` | API key | Seismic risk assessment |
| POST | `/api/predict/storm` | API key | Storm severity + track |
| POST | `/api/predict/tsunami` | API key | Inundation probability |
| POST | `/api/predict/volcanic` | API key | Eruption probability |
| POST | `/api/predict/avalanche` | API key | Snow instability index |
| GET | `/api/model-status` | API key | All loaded models + versions |
| POST | `/api/retrain` | API key | Trigger training pipeline async |
| POST | `/api/models/rollback` | API key | Roll back to previous model version |

### Flood Request Example

```json
POST /api/predict/flood
{
  "latitude": 57.1497,
  "longitude": -2.0943,
  "river_level_m": 2.4,
  "rainfall_24h_mm": 42.0,
  "rainfall_72h_mm": 89.0,
  "soil_moisture_pct": 78.0,
  "forecast_horizon_hours": 48
}
```

Response includes: `probability`, `severity`, `affected_radius_km`, `confidence`, `shap_explanation`, `model_version`.

---

## Input Sanitisation

`sanitize_text()` in `app/api/endpoints.py` is applied to all free-text fields before they reach any model:

1. Strip control characters (Unicode categories `Cc` and `Cf`)
2. Unicode NFC normalisation
3. Soft length cap (truncation, not error)

---

## Hazard Prediction Architecture

Each hazard module follows the same pattern:

```
request → feature extraction → model ensemble → calibration → SHAP → response
                                     ↓ (model unavailable)
                             physics-based fallback
```

**Flood predictor** (`app/hazards/flood.py`):
- Primary: LSTM time-series model (river level + rainfall history)
- Secondary: XGBoost gradient booster (meteorological features)
- Ensemble: probability-weighted average
- Fallback: rational formula (Q = CIA) using raw meteorological inputs
- Explainability: SHAP TreeExplainer for top-3 contributing features

---

## Training Pipeline

The 8-step pipeline (`app/training/training_pipeline.py`):

1. **Ingest** — pull raw records from PostgreSQL feature store
2. **Validate** — schema check, missing value report
3. **Preprocess** — imputation, scaling, lag feature generation
4. **Split** — temporal train/validation/test split (no shuffle — respects time order)
5. **Tune** — Optuna hyperparameter search (100 trials, pruning enabled)
6. **Train** — full train with best hyperparameters + early stopping
7. **Evaluate** — ROC-AUC, precision, recall, F1, confusion matrix, SHAP summary
8. **Register** — save model to `model_registry/` with metadata JSON

Run for one hazard:

```bash
python run_training_all.py --hazard flood --region scotland
```

Run all hazards:

```bash
python run_training_all.py
```

---

## Drift Monitoring

`app/monitoring/drift_detector.py` runs after every batch of 100 predictions:
- **PSI** (Population Stability Index) on numeric features: `> 0.2` triggers alert
- **KS test** on distributions: `p < 0.05` triggers alert
- Alerts are logged to `logs/drift.log` and POST-ed to the server's internal webhook if configured

---

## Docker

```bash
# Build
docker build -t aegis-ai-engine .

# Run standalone
docker run -p 127.0.0.1:8000:8000 \
  -e API_KEY_SECRET=changeme \
  aegis-ai-engine
```

Within the full stack, the service runs as the `ai-engine` container in `docker-compose.yml`. The Node.js server reaches it at `http://ai-engine:8000`.

**Note:** The compose file binds `127.0.0.1:8000:8000` — the AI engine is not exposed to the public internet in production.

---

## Running Tests

```bash
cd aegis-v6/ai-engine
pytest tests/ -v
```

Test reports and coverage output go to `reports/`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `API_KEY_SECRET` | Yes | Shared secret for `X-API-Key` header |
| `DATABASE_URL` | Yes | PostgreSQL connection string for feature store |
| `MODEL_REGISTRY_PATH` | No | Override path to model registry (default: `./model_registry`) |
| `LOG_LEVEL` | No | `DEBUG` / `INFO` / `WARNING` (default: `INFO`) |
| `MLFLOW_TRACKING_URI` | No | MLflow tracking server for experiment logging |
