"""
File: metrics.py

What this file does:
Prometheus metrics definitions for the AI engine: prediction counters
(by hazard type and region), prediction latency histograms, and model
health gauges. Exposes a /metrics endpoint that Prometheus scrapes every
15 seconds.

How it connects:
- setup_metrics() called in ai-engine/main.py at startup
- Counters incremented in ai-engine/app/api/endpoints.py after each prediction
- Scraped by Prometheus (see aegis-v6/docker/prometheus/prometheus.yml)
- Visualised in Grafana (see aegis-v6/docker/grafana/dashboards/)
"""

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import FastAPI, Response
from loguru import logger

# Define metrics
prediction_counter = Counter(
    'aegis_predictions_total',
    'Total number of predictions',
    ['hazard_type', 'region_id']
)

prediction_latency = Histogram(
    'aegis_prediction_latency_seconds',
    'Prediction latency in seconds',
    ['hazard_type']
)

model_load_gauge = Gauge(
    'aegis_models_loaded',
    'Number of models currently loaded'
)

error_counter = Counter(
    'aegis_errors_total',
    'Total number of errors',
    ['error_type']
)

def setup_metrics(app: FastAPI):
    """
    Setup Prometheus metrics endpoint.
    """
    
    @app.get("/metrics")
    async def metrics():
        """Prometheus metrics endpoint."""
        return Response(
            content=generate_latest(),
            media_type=CONTENT_TYPE_LATEST
        )
    
    logger.success("Prometheus metrics enabled at /metrics")
