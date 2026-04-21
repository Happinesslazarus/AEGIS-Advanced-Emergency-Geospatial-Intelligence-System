"""
FastAPI router that exposes all AI prediction endpoints. Each route accepts
a location and optional context, runs the appropriate hazard predictor, and
returns a structured PredictionResponse. Also handles model status queries,
manual retraining triggers, SHAP explanations, and the LLM chat endpoint.

- Mounted in ai-engine/main.py as the primary API router
- Imports all 10 hazard predictors from ai-engine/app/hazards/
- Input/output shapes validated by ai-engine/app/schemas/predictions.py
- Rate limited by ai-engine/app/core/rate_limit.py (120 req/min default)
- API key auth via ai-engine/app/core/auth.py (X-API-Key header)

- POST /predict               -- single hazard prediction
- POST /predict/batch         -- multiple locations in one call
- POST /classify              -- report category classification
- POST /severity              -- severity level prediction
- POST /fake-detection        -- report authenticity check
- GET  /models                -- list models and health status
- POST /retrain/{hazard_type} -- trigger manual retraining
- POST /chat                  -- LLM situational-awareness chat

- ai-engine/app/schemas/predictions.py          -- request/response models
- server/src/services/aiAnalysisPipeline.ts     -- how server calls these routes
"""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query, Body, Request, UploadFile, File
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from loguru import logger
import asyncio
import re
import unicodedata
from app.core.rate_limit import limiter
from app.core.auth import verify_api_key

# Input sanitization 

# CTRL_RE: matches ASCII control characters EXCEPT tab (\t), newline (\n),
# and carriage return (\r) which are valid in multi-line text inputs.
# Strips null bytes and other non-printable chars that could confuse the
# NLP models or cause JSON serialization issues downstream.
_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

def sanitize_text(value: str, max_len: int = 2000) -> str:
    """Strip control characters and enforce length limit on free-text inputs."""
    if not value:
        return ""
    # Normalise unicode (NFC) to prevent homoglyph tricks
    value = unicodedata.normalize("NFC", value)
    # Remove ASCII control chars (keep \t \n \r)
    value = _CTRL_RE.sub("", value)
    return value[:max_len].strip()

from app.schemas.predictions import (
    PredictionRequest,
    PredictionResponse,
    ModelStatus,
    HealthResponse,
    HazardTypeInfo,
    RetrainRequest,
    RetrainResponse,
    HazardType,
    RiskLevel,
)
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.hazards.flood import FloodPredictor
from app.hazards.drought import DroughtPredictor
from app.hazards.heatwave import HeatwavePredictor
from app.hazards.severe_storm import SevereStormPredictor
from app.hazards.landslide import LandslidePredictor
from app.hazards.power_outage import PowerOutagePredictor
from app.hazards.water_supply_disruption import WaterSupplyPredictor
from app.hazards.infrastructure_damage import InfrastructureDamagePredictor
from app.hazards.public_safety_incident import PublicSafetyPredictor
from app.hazards.environmental_hazard import EnvironmentalHazardPredictor
from app.hazards.wildfire import WildfirePredictor
from app.models.ml_wrappers import ReportClassifierML, SeverityPredictorML, TrainedModelLoader
from app.models.report_classifier_ml import ReportClassifierTrainable
from app.models.fake_detector_ml import FakeDetectorTrainable
from app.core.config import settings
from app.core.governance import governance, prediction_logger, drift_detector
from app.monitoring.model_monitor import ModelMonitor


def _safe_error_detail(msg: str, exc: Exception) -> str:
    """Return exception detail only in debug mode; generic message in production."""
    if settings.DEBUG:
        return f"{msg}: {str(exc)}"
    return msg


# Request body models
class ClassifyReportBody(BaseModel):
    text: str
    description: str = ""
    location: str = ""

class PredictSeverityBody(BaseModel):
    text: str
    description: str = ""
    trapped_persons: int = 0
    affected_area_km2: float = 0
    population_affected: int = 0
    hazard_type: Optional[str] = None

class DetectFakeBody(BaseModel):
    text: str
    description: str = ""
    user_reputation: float = 0.5
    image_count: int = 0
    location_verified: bool = False
    source_type: str = "user_report"
    submission_frequency: int = 1
    similar_reports_count: int = 0

# Predictor registry — maps each HazardType to its predictor class.
# Adding a new hazard type only requires one entry here + a predictor module.
HAZARD_PREDICTOR_REGISTRY: dict = {}  # populated after HazardType is imported below

def _build_predictor_registry() -> dict:
    return {
        HazardType.FLOOD: FloodPredictor,
        HazardType.DROUGHT: DroughtPredictor,
        HazardType.HEATWAVE: HeatwavePredictor,
        HazardType.SEVERE_STORM: SevereStormPredictor,
        HazardType.LANDSLIDE: LandslidePredictor,
        HazardType.POWER_OUTAGE: PowerOutagePredictor,
        HazardType.WATER_SUPPLY: WaterSupplyPredictor,
        HazardType.INFRASTRUCTURE: InfrastructureDamagePredictor,
        HazardType.PUBLIC_SAFETY: PublicSafetyPredictor,
        HazardType.ENVIRONMENTAL: EnvironmentalHazardPredictor,
        HazardType.WILDFIRE: WildfirePredictor,
    }

# Create router
router = APIRouter()

# Model initialization: each block is wrapped individually so one missing
# model file doesn't prevent other models from loading.  When a block fails,
# the global is set to None and endpoints that require it return 503.
try:
    model_loader = TrainedModelLoader(settings.MODEL_REGISTRY_PATH)
    report_classifier_ml = ReportClassifierML(model_loader)
    severity_predictor_ml = SeverityPredictorML(model_loader)
except Exception as e:
    logger.error(f"Failed to initialize ML models: {e}")
    report_classifier_ml = None
    severity_predictor_ml = None

# Initialize trainable models (with real training capability)
try:
    report_classifier_trainable = ReportClassifierTrainable()
    fake_detector_trainable = FakeDetectorTrainable()
except Exception as e:
    logger.error(f"Failed to initialize trainable models: {e}")
    report_classifier_trainable = None
    fake_detector_trainable = None

# Import severity predictor for direct training
from app.models.severity_predictor import SeverityPredictor
severity_predictor_direct = SeverityPredictor()

# Global instances (injected via dependency)
_model_registry: ModelRegistry = None
_feature_store: FeatureStore = None
_model_monitor: Optional[ModelMonitor] = None

def get_model_registry() -> ModelRegistry:
    """Dependency injection for model registry.
    
    Importing from main inside the function (lazy import) avoids a circular
    import at module load time: main.py imports this router, which would
    otherwise try to import main.py at the top level.
    """
    from main import model_registry
    return model_registry

def get_feature_store() -> FeatureStore:
    """Dependency injection for feature store."""
    from main import feature_store
    return feature_store

def get_model_monitor(
    model_registry: ModelRegistry = Depends(get_model_registry),
) -> ModelMonitor:
    """Dependency injection for model monitor singleton."""
    global _model_monitor
    if _model_monitor is None:
        _model_monitor = ModelMonitor(model_registry)
    return _model_monitor

@router.post("/predict", response_model=PredictionResponse, dependencies=[Depends(verify_api_key)])
@limiter.limit("100/minute")
async def predict_hazard(
    request: Request,
    payload: PredictionRequest,
    model_registry: ModelRegistry = Depends(get_model_registry),
    feature_store: FeatureStore = Depends(get_feature_store)
):
    """
    PRIMARY PREDICTION ENDPOINT
    
    Generate hazard prediction for a specific location and hazard type.
    
    This is the core endpoint that Node.js will call internally.
    """
    
    try:
        logger.info(
            f"Prediction request: {payload.hazard_type.value} "
            f"for region {payload.region_id}"
        )
        
        # Route to the registered predictor for this hazard type.
        # HAZARD_PREDICTOR_REGISTRY maps every HazardType to its class; unknown
        # types return a safe LOW baseline so callers always get a valid response.
        registry = _build_predictor_registry()
        predictor_cls = registry.get(payload.hazard_type)
        if predictor_cls is None:
            logger.warning(f"No predictor for {payload.hazard_type.value} -- returning safe LOW")
            from app.schemas.predictions import ContributingFactor
            return PredictionResponse(
                model_version="rule-v1.0.0",
                hazard_type=payload.hazard_type,
                region_id=payload.region_id,
                probability=0.05,
                risk_level=RiskLevel.LOW,
                confidence=0.50,
                predicted_peak_time=None,
                geo_polygon=None,
                contributing_factors=[
                    ContributingFactor(factor="baseline_risk", value=0.05, importance=1.0, unit="probability")
                ] if payload.include_contributing_factors else [],
                generated_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(hours=6),
                data_sources=["rule_based"],
                warnings=[]
            )
        predictor = predictor_cls(model_registry, feature_store)
        
        # Generate prediction
        prediction = await predictor.predict(payload)
        
        logger.success(
            f"Prediction generated: {prediction.hazard_type.value}, "
            f"risk={prediction.risk_level.value}, "
            f"prob={prediction.probability:.2f}"
        )
        
        return prediction
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Prediction failed")
        raise HTTPException(
            status_code=500,
            detail=_safe_error_detail("Prediction failed", e)
        )

@router.get("/model-status", response_model=Dict[str, Any])
async def get_model_status(
    model_registry: ModelRegistry = Depends(get_model_registry)
):
    """
    Get status of all loaded models.
    """
    
    try:
        models = model_registry.list_models()
        try:
            drift_threshold = float(getattr(settings, 'DRIFT_THRESHOLD', 0.3) or 0.3)
        except (TypeError, ValueError):
            drift_threshold = 0.3
        
        model_statuses = []
        for model in models:
            try:
                prediction_count = int(model.get('prediction_count', 0) or 0)
            except (TypeError, ValueError):
                prediction_count = 0
            raw_status = str(model.get('health_status') or model.get('status') or '').strip().lower()
            try:
                drift_score = float(model.get('drift_score', 0.0) or 0.0)
            except (TypeError, ValueError):
                drift_score = 0.0
            drift_detected = bool(model.get('drift_detected', False)) or drift_score >= drift_threshold

            if raw_status in {'offline', 'failed', 'error', 'unavailable'}:
                normalized_status = 'offline'
            elif raw_status in {'degraded', 'warning', 'critical'} or drift_detected:
                normalized_status = 'degraded'
            elif prediction_count > 0:
                normalized_status = 'operational'
            else:
                normalized_status = 'standby'

            status = ModelStatus(
                model_name=model['name'],
                model_version=model['version'],
                status=normalized_status,
                last_prediction=model.get('last_prediction') or model.get('last_prediction_at'),
                total_predictions=prediction_count,
                average_latency_ms=model['avg_latency_ms'],
                drift_detected=drift_detected,
                last_trained=model.get('trained_at')
            )
            model_statuses.append(status)

        overall_status = 'operational'
        if any(m.status == 'offline' for m in model_statuses):
            overall_status = 'degraded'
        if any(m.status == 'degraded' for m in model_statuses):
            overall_status = 'degraded'
        
        return {
            "status": overall_status,
            "timestamp": datetime.utcnow().isoformat(),
            "models_loaded": model_registry.count_models(),
            "models": [m.dict() for m in model_statuses]
        }
        
    except Exception as e:
        logger.error(f"Failed to get model status: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.get("/hazard-types", response_model=List[HazardTypeInfo])
async def get_hazard_types(
    model_registry: ModelRegistry = Depends(get_model_registry)
):
    """
    List all supported hazard types and their capabilities.
    """
    
    try:
        from app.core.config import settings
        
        hazard_types = []
        
        if settings.ENABLE_FLOOD_MODULE:
            hazard_types.append(HazardTypeInfo(
                hazard_type=HazardType.FLOOD,
                enabled=True,
                models_available=[
                    m['name'] for m in model_registry.list_models()
                    if m['hazard_type'] == 'flood'
                ],
                supported_regions=model_registry.get_supported_regions('flood'),
                forecast_horizons=[6, 12, 24, 48, 72]
            ))
        
        if settings.ENABLE_DROUGHT_MODULE:
            hazard_types.append(HazardTypeInfo(
                hazard_type=HazardType.DROUGHT,
                enabled=True,
                models_available=[
                    m['name'] for m in model_registry.list_models()
                    if m['hazard_type'] == 'drought'
                ],
                supported_regions=model_registry.get_supported_regions('drought'),
                forecast_horizons=[168, 336, 720]  # 7, 14, 30 days
            ))
        
        if settings.ENABLE_HEATWAVE_MODULE:
            hazard_types.append(HazardTypeInfo(
                hazard_type=HazardType.HEATWAVE,
                enabled=True,
                models_available=[
                    m['name'] for m in model_registry.list_models()
                    if m['hazard_type'] == 'heatwave'
                ],
                supported_regions=model_registry.get_supported_regions('heatwave'),
                forecast_horizons=[24, 48, 72, 120]
            ))
        
        if settings.ENABLE_WILDFIRE_MODULE:
            hazard_types.append(HazardTypeInfo(
                hazard_type=HazardType.WILDFIRE,
                enabled=True,
                models_available=["wildfire_fdi_v1"],
                supported_regions=["global"],
                forecast_horizons=[6, 12, 24]
            ))

        # Remaining 7 hazard types (always enabled, use trained models or heuristic fallback)
        all_models = model_registry.list_models()

        ADDITIONAL_HAZARDS = [
            (HazardType.SEVERE_STORM, "severe_storm", [6, 12, 24, 48]),
            (HazardType.LANDSLIDE, "landslide", [12, 24, 48]),
            (HazardType.POWER_OUTAGE, "power_outage", [6, 12, 24]),
            (HazardType.WATER_SUPPLY, "water_supply_disruption", [24, 48, 168]),
            (HazardType.INFRASTRUCTURE, "infrastructure_damage", [12, 24, 48]),
            (HazardType.PUBLIC_SAFETY, "public_safety_incident", [6, 12, 24]),
            (HazardType.ENVIRONMENTAL, "environmental_hazard", [12, 24, 48]),
        ]

        for hazard_enum, hazard_key, horizons in ADDITIONAL_HAZARDS:
            hazard_models = [m['name'] for m in all_models if m.get('hazard_type') == hazard_key]
            # Also check shortened key variants
            if not hazard_models:
                short_key = hazard_key.replace("_disruption", "").replace("_incident", "").replace("_damage", "")
                hazard_models = [m['name'] for m in all_models if m.get('hazard_type') == short_key]

            hazard_types.append(HazardTypeInfo(
                hazard_type=hazard_enum,
                enabled=True,
                models_available=hazard_models if hazard_models else [f"{hazard_key}_heuristic_v1"],
                supported_regions=model_registry.get_supported_regions(hazard_key) or ["global"],
                forecast_horizons=horizons,
            ))
        
        return hazard_types
        
    except Exception as e:
        logger.error(f"Failed to get hazard types: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.post("/retrain", response_model=RetrainResponse, dependencies=[Depends(verify_api_key)])
async def trigger_retrain(
    request: RetrainRequest,
    background_tasks: BackgroundTasks
):
    """
    Trigger REAL model retraining (REQUIRES API KEY).
    Trains models on actual database data -- no stubs, no fakes.
    """
    
    try:
        import uuid
        job_id = str(uuid.uuid4())
        db_url = settings.DATABASE_URL
        
        logger.info(
            f"Retrain request: {request.hazard_type.value} "
            f"for {request.region_id}, job_id={job_id}"
        )
        
        # Execute training based on model type
        results = {}
        
        if request.hazard_type.value in ['all', 'severity']:
            logger.info("Training severity predictor...")
            try:
                severity_result = await severity_predictor_direct.async_train(db_url)
                results['severity_predictor'] = severity_result
                logger.success(f"Severity trained: accuracy={severity_result.get('accuracy', 'N/A')}")
            except Exception as e:
                results['severity_predictor'] = {'error': str(e)}
                logger.error(f"Severity training failed: {e}")
        
        if request.hazard_type.value in ['all', 'report_classifier']:
            logger.info("Training report classifier...")
            try:
                if report_classifier_trainable:
                    classifier_result = await report_classifier_trainable.async_train(db_url)
                    results['report_classifier'] = classifier_result
                    logger.success(f"Classifier trained: accuracy={classifier_result.get('accuracy', 'N/A')}")
                else:
                    results['report_classifier'] = {'error': 'Classifier not initialized'}
            except Exception as e:
                results['report_classifier'] = {'error': str(e)}
                logger.error(f"Classifier training failed: {e}")
        
        if request.hazard_type.value in ['all', 'fake_detector']:
            logger.info("Training fake detector...")
            try:
                if fake_detector_trainable:
                    fake_result = await fake_detector_trainable.async_train(db_url)
                    results['fake_detector'] = fake_result
                    logger.success(f"Fake detector trained: accuracy={fake_result.get('accuracy', 'N/A')}")
                else:
                    results['fake_detector'] = {'error': 'Fake detector not initialized'}
            except Exception as e:
                results['fake_detector'] = {'error': str(e)}
                logger.error(f"Fake detector training failed: {e}")
        
        # Determine overall status: 'completed' if all models succeeded,
        # 'partial' if at least one succeeded, 'failed' if all errored.
        has_errors = any('error' in r for r in results.values())
        has_success = any('accuracy' in r or 'f1_weighted' in r for r in results.values())
        
        status = "completed" if has_success and not has_errors else "partial" if has_success else "failed"
        
        return RetrainResponse(
            job_id=job_id,
            status=status,
            message=f"Training {status}: {', '.join(results.keys())}",
            estimated_completion=datetime.utcnow()
        )
        
    except Exception as e:
        logger.error(f"Failed to queue retrain job: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.post("/classify-image", dependencies=[Depends(verify_api_key)])
async def classify_image(file: UploadFile = File(...)):
    """
    Classify disaster image using CLIP ViT-B-32 zero-shot inference.
    Returns hazard type, confidence, severity, and per-class probabilities.
    """
    from app.models import ImageClassifier

    # Validate MIME type before reading full content
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff"}
    if file.content_type and file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}. Allowed: {', '.join(sorted(allowed_types))}")

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")

    # Validate magic bytes match an image format
    magic_signatures = {
        b'\xff\xd8\xff': 'JPEG',
        b'\x89PNG': 'PNG',
        b'RIFF': 'WebP',  # WebP starts with RIFF
        b'GIF8': 'GIF',
        b'II\x2a\x00': 'TIFF',
        b'MM\x00\x2a': 'TIFF',
    }
    if not any(image_bytes[:4].startswith(sig) for sig in magic_signatures):
        raise HTTPException(status_code=400, detail="File does not appear to be a valid image")

    classifier = ImageClassifier()
    result = await classifier.classify(image_bytes)

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return result

@router.post("/classify-report", dependencies=[Depends(verify_api_key)])
@limiter.limit("30/minute")
async def classify_report(
    request: Request,
    body: ClassifyReportBody = None,
    text: str = Query(None),
    description: str = Query(""),
    location: str = Query("")
):
    """
    Classify disaster report using REAL trained ML model.
    Uses XGBoost trained on real reports from the database.
    Accepts JSON body or query parameters.
    """
    # Support both JSON body and query params
    _text = sanitize_text((body.text if body else None) or text or "")
    _description = sanitize_text((body.description if body else None) or description or "", max_len=500)
    _location = sanitize_text((body.location if body else None) or location or "", max_len=200)

    try:
        if len(_text.strip()) < 3:
            raise HTTPException(status_code=400, detail="Report text too short")

        # Three-tier fallback: trainable (directly trained XGBoost) -> ML wrapper
        # (loaded from artifact store) -> keyword rule engine.  Each falls through
        # only when the previous tier's model hasn't been fitted yet.
        if report_classifier_trainable and report_classifier_trainable.model is not None:
            import time as _time
            _start = _time.time()
            result = await asyncio.to_thread(
                report_classifier_trainable.classify, _text, _description, _location
            )
            _latency = int((_time.time() - _start) * 1000)
            logger.success(f"Report classified (trainable): {result.get('primary_hazard')} (trained={result.get('trained')})")
            # Log prediction
            try:
                await prediction_logger.log_prediction(
                    model_name="report_classifier",
                    model_version=result.get('model_version', 'unknown'),
                    input_data={"text": _text[:200], "description": _description[:100], "location": _location},
                    prediction=result,
                    confidence=result.get('confidence', 0),
                    latency_ms=_latency,
                )
            except Exception as log_err:
                logger.warning(f"Prediction log failed: {log_err}")
            return result
        
        # Fall back to ML wrapper (loaded from model_registry)
        if report_classifier_ml:
            result = report_classifier_ml.classify(_text, _description, _location)
            if result.get('trained'):
                logger.success(f"Report classified (wrapper): {result.get('primary_hazard')}")
                return result
        
        # Last resort: trainable classifier keyword fallback
        if report_classifier_trainable:
            result = report_classifier_trainable.classify(_text, _description, _location)
            logger.warning(f"Report classified (keyword fallback): {result.get('primary_hazard')}")
            return result
        
        raise HTTPException(
            status_code=503,
            detail="ML models not loaded. Train first via POST /api/retrain"
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Report classification failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.post("/predict-severity", dependencies=[Depends(verify_api_key)])
@limiter.limit("30/minute")
async def predict_severity(
    request: Request,
    body: PredictSeverityBody = None,
    text: str = Query(None),
    description: str = Query(""),
    trapped_persons: int = Query(0),
    affected_area_km2: float = Query(0),
    population_affected: int = Query(0),
    hazard_type: Optional[str] = Query(None)
):
    """
    Predict severity level using REAL trained ML model.
    Accepts JSON body or query parameters.
    """
    _text = sanitize_text((body.text if body else None) or text or "")
    _description = sanitize_text((body.description if body else None) or description or "", max_len=500)
    _trapped = (body.trapped_persons if body else None) or trapped_persons
    _area = (body.affected_area_km2 if body else None) or affected_area_km2
    _pop = (body.population_affected if body else None) or population_affected
    _hazard = sanitize_text((body.hazard_type if body else None) or hazard_type or "", max_len=50)

    try:
        if len(_text.strip()) < 3:
            raise HTTPException(status_code=400, detail="Report text required")

        import time as _time
        _start = _time.time()
        result = await asyncio.to_thread(
            severity_predictor_direct.predict,
            _text, _description, _trapped, _area, _pop, _hazard,
        )
        _latency = int((_time.time() - _start) * 1000)
        
        if not result.get('trained'):
            logger.warning("Severity predictor not trained - model training required")
        
        logger.success(f"Severity predicted: {result.get('severity')} (trained={result.get('trained')})")
        
        # Log prediction
        try:
            await prediction_logger.log_prediction(
                model_name="severity_predictor",
                model_version=result.get('model_version', 'unknown'),
                input_data={"text": _text[:200], "description": _description[:100], "hazard_type": _hazard},
                prediction=result,
                confidence=result.get('confidence', 0),
                latency_ms=_latency,
            )
        except Exception as log_err:
            logger.warning(f"Prediction log failed: {log_err}")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Severity prediction failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.post("/detect-fake", dependencies=[Depends(verify_api_key)])
@limiter.limit("30/minute")
async def detect_fake(
    request: Request,
    body: DetectFakeBody = None,
    text: str = Query(None),
    description: str = Query(""),
    user_reputation: float = Query(0.5),
    image_count: int = Query(0),
    location_verified: bool = Query(False),
    source_type: str = Query("user_report"),
    submission_frequency: int = Query(1),
    similar_reports_count: int = Query(0)
):
    """
    Detect fake/spam reports using REAL trained ML model.
    Accepts JSON body or query parameters.
    """
    _text = sanitize_text(body.text if body else (text or ""))
    _description = sanitize_text(body.description if body else description, max_len=500)
    _reputation = body.user_reputation if body else user_reputation
    _images = body.image_count if body else image_count
    _verified = body.location_verified if body else location_verified
    _source = sanitize_text(body.source_type if body else source_type, max_len=50)
    _freq = body.submission_frequency if body else submission_frequency
    _similar = body.similar_reports_count if body else similar_reports_count

    try:
        if len(_text.strip()) < 3:
            raise HTTPException(status_code=400, detail="Report text required")

        if not fake_detector_trainable:
            raise HTTPException(
                status_code=503,
                detail="Fake detector not initialized. Restart AI engine."
            )

        result = await asyncio.to_thread(
            fake_detector_trainable.detect,
            _text, _description, _reputation, _images, _verified,
            _source, _freq, _similar,
        )
        
        logger.info(f"Fake detection: {result.get('classification')} (trained={result.get('trained')})")
        
        # Log prediction
        try:
            await prediction_logger.log_prediction(
                model_name="fake_detector",
                model_version=result.get('model_version', 'unknown'),
                input_data={"text": _text[:200], "user_reputation": _reputation, "source_type": _source},
                prediction=result,
                confidence=result.get('confidence', 0),
                latency_ms=0,
            )
        except Exception as log_err:
            logger.warning(f"Prediction log failed: {log_err}")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Fake detection failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

# LIVE DATA ENDPOINT -- Real-time sensor data from SEPA, EA, Open-Meteo, NOAA
@router.get("/live-data")
async def get_live_data(
    lat: float,
    lng: float,
    region_id: str = "scotland",
):
    """
    Fetch real-time environmental data from free public APIs.
    Returns feature overrides suitable for hazard predictions,
    plus raw provider responses for transparency.

    Sources: SEPA river gauges, EA Flood Monitoring, Open-Meteo weather,
    NOAA ENSO index, NASA FIRMS fire hotspots, Open-Elevation.
    """
    from app.core.data_providers import fetch_live_features

    try:
        result = await fetch_live_features(lat, lng, region_id)
        return {
            "status": "ok",
            "latitude": lat,
            "longitude": lng,
            "region_id": region_id,
            "live_features": result["feature_overrides"],
            "data_quality": result["data_quality"],
            "live_feature_count": result["live_feature_count"],
            "total_feature_count": result["total_feature_count"],
            "raw_sources": result["raw_sources"],
        }
    except Exception as e:
        logger.error(f"Live data fetch failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Live data unavailable", e))

@router.get("/health")
async def health_check():
    """
    Detailed health check for monitoring.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "aegis-ai-engine",
        "version": "1.0.0"
    }

@router.get("/")
async def root():
    """
    API root - information endpoint.
    """
    return {
        "service": "AEGIS AI Engine",
        "version": "2.0.0",
        "description": "Multi-hazard environmental intelligence platform",
        "endpoints": {
            "predict": "/api/predict",
            "model_status": "/api/model-status",
            "hazard_types": "/api/hazard-types",
            "retrain": "/api/retrain",
            "classify_image": "/api/classify-image",
            "classify_report": "/api/classify-report",
            "predict_severity": "/api/predict-severity",
            "detect_fake": "/api/detect-fake",
            "health": "/api/health",
            "models_list": "/api/models",
            "models_versions": "/api/models/{model_name}/versions",
            "models_rollback": "/api/models/rollback",
            "drift_check": "/api/drift/check",
            "prediction_feedback": "/api/predictions/{prediction_id}/feedback",
            "registry_versions": "/api/registry/versions/{hazard_type}/{region_id}",
            "registry_promote": "/api/registry/promote/{hazard_type}/{region_id}/{version}",
            "registry_demote": "/api/registry/demote/{hazard_type}/{region_id}",
            "registry_validate": "/api/registry/validate/{hazard_type}/{region_id}/{version}",
            "registry_cleanup": "/api/registry/cleanup/{hazard_type}/{region_id}",
            "registry_cleanup_all": "/api/registry/cleanup-all",
        },
        "documentation": "/docs"
    }

# §  MODEL GOVERNANCE ENDPOINTS

@router.get("/models", dependencies=[Depends(verify_api_key)])
async def list_governed_models():
    """List all models with their active version and governance status."""
    try:
        models = await governance.list_all_models()
        return {
            "models": models,
            "total": len(models),
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"List models failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.get("/models/{model_name}/versions", dependencies=[Depends(verify_api_key)])
async def list_model_versions(model_name: str, limit: int = 20):
    """List all versions for a specific model."""
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', model_name):
        raise HTTPException(status_code=400, detail="Invalid model name (alphanumeric, hyphens, underscores only)")
    limit = max(1, min(limit, 100))
    try:
        versions = await governance.list_versions(model_name, limit)
        active = await governance.get_active_version(model_name)
        return {
            "model_name": model_name,
            "active_version": active["version"] if active else None,
            "versions": versions,
            "total": len(versions),
        }
    except Exception as e:
        logger.error(f"List versions failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.post("/models/rollback", dependencies=[Depends(verify_api_key)])
async def rollback_model(model_name: str, target_version: Optional[str] = None):
    """
    Roll back a model to its previous stable version.
    If target_version is not specified, rolls back to the most recent archived version.
    """
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', model_name):
        raise HTTPException(status_code=400, detail="Invalid model name")
    if target_version and not re.match(r'^[a-zA-Z0-9._-]+$', target_version):
        raise HTTPException(status_code=400, detail="Invalid version string")
    try:
        result = await governance.rollback(model_name, target_version)

        if result.get("status") == "error":
            raise HTTPException(status_code=404, detail=result["message"])

        # Reload the model in memory after rollback
        if result.get("status") == "rolled_back":
            to_version = result.get("to_version", "")
            await _reload_model_after_rollback(model_name, to_version)

        logger.success(f"Rollback: {model_name} -> {result.get('to_version')}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rollback failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

async def _reload_model_after_rollback(model_name: str, version: str):
    """Reload model artifacts from the rolled-back version directory."""
    import pickle
    from pathlib import Path

    try:
        active = await governance.get_active_version(model_name)
        if not active:
            return
        artifact_path = Path(active["artifact_path"])
        if not artifact_path.exists():
            logger.warning(f"Artifact path {artifact_path} does not exist for rollback reload")
            return

        if model_name == "severity_predictor":
            model_file = artifact_path / "severity_xgb_model.pkl"
            vec_file = artifact_path / "severity_tfidf.pkl"
            if model_file.exists() and vec_file.exists():
                with open(model_file, 'rb') as f:
                    severity_predictor_direct.model = pickle.load(f)
                with open(vec_file, 'rb') as f:
                    severity_predictor_direct.vectorizer = pickle.load(f)
                severity_predictor_direct.model_version = version
                logger.success(f"Reloaded severity_predictor from {version}")

        elif model_name == "report_classifier":
            model_file = artifact_path / "classifier_xgb_model.pkl"
            vec_file = artifact_path / "classifier_tfidf.pkl"
            if model_file.exists() and vec_file.exists() and report_classifier_trainable:
                with open(model_file, 'rb') as f:
                    report_classifier_trainable.model = pickle.load(f)
                with open(vec_file, 'rb') as f:
                    report_classifier_trainable.vectorizer = pickle.load(f)
                report_classifier_trainable.model_version = version
                logger.success(f"Reloaded report_classifier from {version}")

        elif model_name == "fake_detector":
            model_file = artifact_path / "fake_xgb_model.pkl"
            if model_file.exists() and fake_detector_trainable:
                with open(model_file, 'rb') as f:
                    fake_detector_trainable.model = pickle.load(f)
                fake_detector_trainable.model_version = version
                logger.success(f"Reloaded fake_detector from {version}")

    except Exception as e:
        logger.error(f"Model reload after rollback failed: {e}")

# §  DRIFT DETECTION ENDPOINTS

@router.get("/drift/check", dependencies=[Depends(verify_api_key)])
async def check_drift(
    model_name: Optional[str] = None,
    hours: int = 24,
    model_registry: ModelRegistry = Depends(get_model_registry),
    model_monitor: ModelMonitor = Depends(get_model_monitor),
):
    """
    Run drift detection on one or all active models.
    """
    try:
        if model_name:
            active = await governance.get_active_version(model_name)
            if not active:
                raise HTTPException(status_code=404, detail=f"No active version for {model_name}")
            result = await drift_detector.detect_drift(
                model_name, active["version"], window_hours=hours
            )
            return result
        # Dual-source drift check: run the newer per-hazard model_monitor for
        # hazard predictors PLUS the governance-based checker for classifier
        # models that aren't yet tracked by model_monitor.
        else:
            hazard_results = await model_monitor.run_for_all_current_models(hours=hours)

            # Keep legacy governance drift checks for report-classifier models as supplemental signal.
            legacy_results = await drift_detector.check_all_models()

            return {
                "models_checked": hazard_results.get("checked", 0),
                "drift_found": hazard_results.get("critical", 0),
                "results": hazard_results.get("results", []),
                "legacy_governance_models": legacy_results,
                "checked_at": datetime.utcnow().isoformat(),
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Drift check failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.post("/predictions/{prediction_id}/feedback", dependencies=[Depends(verify_api_key)])
async def submit_prediction_feedback(prediction_id: str, feedback: str):
    """
    Submit feedback for a prediction. Accepted values: correct, incorrect, uncertain.
    """
    if feedback not in ('correct', 'incorrect', 'uncertain'):
        raise HTTPException(status_code=400, detail="feedback must be: correct, incorrect, uncertain")
    try:
        success = await prediction_logger.submit_feedback(prediction_id, feedback)
        if not success:
            raise HTTPException(status_code=404, detail="Prediction not found")
        return {"status": "ok", "prediction_id": prediction_id, "feedback": feedback}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Feedback submission failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

@router.get("/predictions/stats", dependencies=[Depends(verify_api_key)])
async def prediction_stats(model_name: Optional[str] = None, hours: int = 24):
    """Get prediction statistics for monitoring."""
    try:
        if model_name:
            stats = await prediction_logger.get_confidence_stats(model_name, hours)
            return {"model_name": model_name, **stats}
        else:
            # Get stats for all known models
            all_stats = {}
            for name in ["severity_predictor", "report_classifier", "fake_detector"]:
                all_stats[name] = await prediction_logger.get_confidence_stats(name, hours)
            return {"models": all_stats, "window_hours": hours}
    except Exception as e:
        logger.error(f"Prediction stats failed: {e}")
        raise HTTPException(status_code=500, detail=_safe_error_detail("Internal server error", e))

# §  MODEL LIFECYCLE ENDPOINTS

@router.get("/registry/versions/{hazard_type}/{region_id}", dependencies=[Depends(verify_api_key)])
async def list_registry_versions(
    hazard_type: str,
    region_id: str,
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """List all versions for a hazard+region from the on-disk model registry."""
    versions = model_registry.list_versions(hazard_type, region_id)
    current_key = model_registry.get_current_model_key(hazard_type, region_id)
    return {
        "hazard_type": hazard_type,
        "region_id": region_id,
        "current_key": current_key,
        "versions": versions,
        "total": len(versions),
    }

@router.post("/registry/promote/{hazard_type}/{region_id}/{version}", dependencies=[Depends(verify_api_key)])
async def promote_registry_model(
    hazard_type: str,
    region_id: str,
    version: str,
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Promote a specific model version as the active model."""
    result = model_registry.promote_model(hazard_type, region_id, version)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@router.post("/registry/demote/{hazard_type}/{region_id}", dependencies=[Depends(verify_api_key)])
async def demote_registry_model(
    hazard_type: str,
    region_id: str,
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Remove manual promotion override, revert to automatic selection."""
    return model_registry.demote_model(hazard_type, region_id)

@router.get("/registry/validate/{hazard_type}/{region_id}/{version}", dependencies=[Depends(verify_api_key)])
async def validate_registry_model(
    hazard_type: str,
    region_id: str,
    version: str,
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Validate integrity of a specific model version."""
    return model_registry.validate_model_integrity(hazard_type, region_id, version)

@router.post("/registry/cleanup/{hazard_type}/{region_id}", dependencies=[Depends(verify_api_key)])
async def cleanup_registry_versions(
    hazard_type: str,
    region_id: str,
    keep: int = Query(3, ge=1, le=10),
    dry_run: bool = Query(False),
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Remove old model versions, keeping the N newest + promoted."""
    return model_registry.cleanup_old_versions(hazard_type, region_id, keep=keep, dry_run=dry_run)

@router.post("/registry/cleanup-all", dependencies=[Depends(verify_api_key)])
async def cleanup_all_registry(
    keep: int = Query(3, ge=1, le=10),
    dry_run: bool = Query(True),
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Run cleanup across all hazard+region combinations."""
    return model_registry.cleanup_all_hazards(keep=keep, dry_run=dry_run)

@router.get("/registry/health/{hazard_type}/{region_id}", dependencies=[Depends(verify_api_key)])
async def get_registry_model_health(
    hazard_type: str,
    region_id: str,
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Get health summary for active model in hazard/region."""
    return model_registry.get_model_health(hazard_type, region_id)

@router.get("/registry/health", dependencies=[Depends(verify_api_key)])
async def get_all_registry_model_health(
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Get health summary for all hazard/region active models."""
    combos = sorted({(m.hazard_type, m.region_id) for m in model_registry.models.values()})
    data = [model_registry.get_model_health(h, r) for h, r in combos]
    return {
        "count": len(data),
        "items": data,
        "generated_at": datetime.utcnow().isoformat(),
    }

@router.get("/registry/drift/{hazard_type}/{region_id}/{version}", dependencies=[Depends(verify_api_key)])
async def get_registry_drift_snapshot(
    hazard_type: str,
    region_id: str,
    version: str,
    hours: int = Query(24, ge=1, le=168),
    model_monitor: ModelMonitor = Depends(get_model_monitor),
):
    """Compute drift and monitoring snapshot for model version."""
    result = await model_monitor.run_for_model(hazard_type, region_id, version, hours=hours)
    return {
        "hazard_type": hazard_type,
        "region_id": region_id,
        "model_version": version,
        **result,
    }

@router.post("/registry/mark-degraded/{hazard_type}/{region_id}/{version}", dependencies=[Depends(verify_api_key)])
async def mark_registry_model_degraded(
    hazard_type: str,
    region_id: str,
    version: str,
    drift_score: float = Body(0.8),
    reason: str = Body("manual_mark_degraded"),
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Manually mark a model as degraded/rollback_recommended."""
    rollback_version = model_registry.recommend_rollback_target(hazard_type, region_id)
    health_status = "rollback_recommended" if drift_score >= 0.7 else "degraded"
    result = model_registry.mark_model_health(
        hazard_type=hazard_type,
        region_id=region_id,
        version=version,
        health_status=health_status,
        drift_score=drift_score,
        recommended_rollback_version=rollback_version,
        reason=reason,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to mark degraded"))
    return result

@router.get("/registry/recommend-rollback/{hazard_type}/{region_id}", dependencies=[Depends(verify_api_key)])
async def recommend_registry_rollback(
    hazard_type: str,
    region_id: str,
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """Get deterministic rollback recommendation for active model."""
    current = model_registry.get_current_model_key(hazard_type, region_id)
    candidate = model_registry.recommend_rollback_target(hazard_type, region_id)
    return {
        "hazard_type": hazard_type,
        "region_id": region_id,
        "current_key": current,
        "recommended_rollback_version": candidate,
    }

@router.get("/capabilities")
async def get_capabilities(
    model_registry: ModelRegistry = Depends(get_model_registry),
):
    """
    Returns honest capability declarations for all hazard types.
    For each hazard, reports whether a trained ML model exists in the registry
    or if the system falls back to heuristic/rule-based predictions.
    Frontend can use this to show 'limited data' badges.
    """
    ALL_HAZARDS = [
        "flood", "drought", "heatwave", "wildfire", "severe_storm",
        "landslide", "power_outage", "water_supply_disruption",
        "infrastructure_damage", "public_safety_incident", "environmental_hazard",
    ]

    capabilities = []
    all_models = model_registry.list_models()

    for hazard in ALL_HAZARDS:
        # Check if any trained model exists for this hazard type
        hazard_models = [m for m in all_models if m.get("hazard_type") == hazard]
        has_trained_model = len(hazard_models) > 0

        # Check registry naming variants (e.g. water_supply vs water_supply_disruption)
        if not has_trained_model:
            short_name = hazard.replace("_disruption", "").replace("_incident", "").replace("_damage", "")
            hazard_models = [m for m in all_models if m.get("hazard_type") == short_name]
            has_trained_model = len(hazard_models) > 0

        regions = model_registry.get_supported_regions(hazard)

        capabilities.append({
            "hazard_type": hazard,
            "prediction_mode": "ml_model" if has_trained_model else "heuristic_fallback",
            "has_trained_model": has_trained_model,
            "model_count": len(hazard_models),
            "model_names": [m.get("name", "unknown") for m in hazard_models],
            "supported_regions": regions,
            "confidence_note": (
                "Predictions backed by trained ML model"
                if has_trained_model
                else "Using rule-based heuristics; predictions may have lower accuracy"
            ),
        })

    return {
        "hazard_types": capabilities,
        "total_models": len(all_models),
        "ml_backed_count": sum(1 for c in capabilities if c["has_trained_model"]),
        "heuristic_only_count": sum(1 for c in capabilities if not c["has_trained_model"]),
        "timestamp": datetime.utcnow().isoformat(),
    }
