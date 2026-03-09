# AEGIS AI ENGINE

Sovereign-grade multi-hazard environmental intelligence platform.

## Overview

The AEGIS AI Engine is a FastAPI-based service that provides AI-powered hazard prediction capabilities. It integrates seamlessly with the existing Node.js AEGIS backend.

## Features

- **Multi-Hazard Support**: Flood, Drought, Heatwave, Wildfire (extensible)
- **Region-Agnostic**: Works globally with universal feature schema
- **Model Versioning**: Automatic model registry and version management
- **Production-Ready**: Monitoring, logging, error handling
- **Strict API Contracts**: Ensures frontend compatibility

## Quick Start

### Installation

```bash
cd ai-engine
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your configuration
```

### Run Development Server

```bash
python main.py
```

The API will be available at `http://localhost:8000`

## API Documentation

Interactive API docs: `http://localhost:8000/docs`

### Main Endpoints

- `POST /api/predict` - Generate hazard prediction
- `GET /api/model-status` - Get model health status
- `GET /api/hazard-types` - List supported hazards
- `POST /api/retrain` - Trigger model retraining
- `GET /health` - Health check

## Architecture

```
ai-engine/
├── app/
│   ├── api/              # API endpoints
│   ├── core/             # Core components (registry, features)
│   ├── hazards/          # Hazard prediction modules
│   ├── monitoring/       # Logging and metrics
│   └── schemas/          # Pydantic schemas
├── model_registry/       # Trained model storage
├── feature_store/        # Feature cache
├── logs/                 # Application logs
├── config.yaml           # Master configuration
├── requirements.txt      # Python dependencies
└── main.py              # FastAPI application
```

## Model Registry Structure

```
model_registry/
├── flood_scotland_v1/
│   ├── model.pkl
│   └── metadata.json
├── drought_scotland_v1/
│   ├── model.pkl
│   └── metadata.json
└── heatwave_scotland_v1/
    ├── model.pkl
    └── metadata.json
```

## Integration with Node.js

The AI engine exposes REST endpoints that the Node.js backend calls internally:

```javascript
// Node.js example
const response = await fetch('http://localhost:8000/api/predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    hazard_type: 'flood',
    region_id: 'scotland',
    latitude: 57.1497,
    longitude: -2.0943,
    forecast_horizon: 48
  })
});

const prediction = await response.json();
```

## Model Training

Models are trained offline and placed in the `model_registry/` directory with metadata:

```json
{
  "name": "flood_scotland_v1",
  "version": "1.0.0",
  "hazard_type": "flood",
  "region_id": "scotland",
  "trained_at": "2026-03-01T00:00:00Z",
  "performance_metrics": {
    "roc_auc": 0.92,
    "precision": 0.87,
    "recall": 0.85
  },
  "feature_names": ["rainfall_24h", "river_level", ...]
}
```

## Monitoring

- **Prometheus**: Metrics available at `/metrics`
- **Logs**: Structured logging to `logs/` directory
- **Health**: `/health` endpoint for load balancers

## Deployment

### Docker

```bash
docker build -t aegis-ai-engine .
docker run -p 8000:8000 aegis-ai-engine
```

### Production

- Use `uvicorn` with multiple workers
- Set `ENV=production` in `.env`
- Configure external database connection
- Enable authentication middleware
- Set up reverse proxy (nginx)

## License

Proprietary - AEGIS Platform
