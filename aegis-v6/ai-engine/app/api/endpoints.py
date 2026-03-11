"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — API Endpoints
 REST API for hazard prediction and model management
═══════════════════════════════════════════════════════════════════════════════
"""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query, Body
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from loguru import logger

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
from app.models.ml_wrappers import ReportClassifierML, SeverityPredictorML, TrainedModelLoader
from app.models.report_classifier_ml import ReportClassifierTrainable
from app.models.fake_detector_ml import FakeDetectorTrainable
from app.core.config import settings
from app.core.governance import governance, prediction_logger, drift_detector

# ── Request body models ──────────────────────────────────────────────────────
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

# Create router
router = APIRouter()

# Initialize model loader (real trained models)
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


def get_model_registry() -> ModelRegistry:
    """Dependency injection for model registry."""
    from main import model_registry
    return model_registry


def get_feature_store() -> FeatureStore:
    """Dependency injection for feature store."""
    from main import feature_store
    return feature_store


@router.post("/predict", response_model=PredictionResponse)
async def predict_hazard(
    request: PredictionRequest,
    model_registry: ModelRegistry = Depends(get_model_registry),
    feature_store: FeatureStore = Depends(get_feature_store)
):
    """
    ═══════════════════════════════════════════════════════════════════════
    PRIMARY PREDICTION ENDPOINT
    
    Generate hazard prediction for a specific location and hazard type.
    
    This is the core endpoint that Node.js will call internally.
    ═══════════════════════════════════════════════════════════════════════
    """
    
    try:
        logger.info(
            f"Prediction request: {request.hazard_type.value} "
            f"for region {request.region_id}"
        )
        
        # Route to appropriate hazard predictor
        if request.hazard_type == HazardType.FLOOD:
            predictor = FloodPredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.HEATWAVE:
            predictor = HeatwavePredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.WILDFIRE:
            from app.hazards.wildfire import WildfirePredictor
            predictor = WildfirePredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.DROUGHT:
            predictor = DroughtPredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.SEVERE_STORM:
            predictor = SevereStormPredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.LANDSLIDE:
            predictor = LandslidePredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.POWER_OUTAGE:
            predictor = PowerOutagePredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.WATER_SUPPLY:
            predictor = WaterSupplyPredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.INFRASTRUCTURE:
            predictor = InfrastructureDamagePredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.PUBLIC_SAFETY:
            predictor = PublicSafetyPredictor(model_registry, feature_store)
        elif request.hazard_type == HazardType.ENVIRONMENTAL:
            predictor = EnvironmentalHazardPredictor(model_registry, feature_store)
        else:
            logger.warning(f"No predictor for {request.hazard_type.value} — returning safe LOW")
            from app.schemas.predictions import ContributingFactor
            return PredictionResponse(
                model_version="rule-v1.0.0",
                hazard_type=request.hazard_type,
                region_id=request.region_id,
                probability=0.05,
                risk_level=RiskLevel.LOW,
                confidence=0.50,
                predicted_peak_time=None,
                geo_polygon=None,
                contributing_factors=[
                    ContributingFactor(factor="baseline_risk", value=0.05, importance=1.0, unit="probability")
                ] if request.include_contributing_factors else [],
                generated_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(hours=6),
                data_sources=["rule_based"],
                warnings=[]
            )
        
        # Generate prediction
        prediction = await predictor.predict(request)
        
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
            detail=f"Prediction failed: {str(e)}"
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
        
        model_statuses = []
        for model in models:
            status = ModelStatus(
                model_name=model['name'],
                model_version=model['version'],
                status="operational" if model['prediction_count'] > 0 else "standby",
                last_prediction=None,  # Would track in production
                total_predictions=model['prediction_count'],
                average_latency_ms=model['avg_latency_ms'],
                drift_detected=False,  # Would implement drift detection
                last_trained=model.get('trained_at')
            )
            model_statuses.append(status)
        
        return {
            "status": "operational",
            "timestamp": datetime.utcnow().isoformat(),
            "models_loaded": model_registry.count_models(),
            "models": [m.dict() for m in model_statuses]
        }
        
    except Exception as e:
        logger.error(f"Failed to get model status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
        
        return hazard_types
        
    except Exception as e:
        logger.error(f"Failed to get hazard types: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retrain", response_model=RetrainResponse)
async def trigger_retrain(
    request: RetrainRequest,
    background_tasks: BackgroundTasks
):
    """
    Trigger REAL model retraining.
    Trains models on actual database data — no stubs, no fakes.
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
        
        # Determine overall status
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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/classify-image")
async def classify_image(file: bytes):
    """
    Classify disaster image using trained CNN.
    
    NOTE: Image classification requires:
    1. Extraction of images from reports with media (currently in media_url)
    2. Manual labeling of hazard types (flood/fire/drought/etc)
    3. Fine-tuning ResNet50 or EfficientNet on labeled image dataset
    4. Model saved to model_registry/image_classifier/
    
    CURRENT STATUS:
    - Reports table has has_media and media_url fields
    - ~3000 reports have attached images
    - Need labeling pipeline to create training set
    
    TO IMPLEMENT:
    1. Create image_download_and_label.py routine
    2. Label 300+ representative images
    3. Train with PyTorch/TensorFlow in ml_pipeline.py
    4. This endpoint will serve predictions
    """
    from fastapi import File
    
    return {
        'status': 'not_implemented_yet',
        'model': 'image_classifier',
        'message': 'Image classification requires labeled training images',
        'available_images': '~3000 reports with media in database',
        'next_steps': [
            '1. Extract images from media_url fields',
            '2. Label 300+ images with hazard type',
            '3. Fine-tune ResNet50 on labeled set',
            '4. Save model checkpoint',
            '5. Endpoint will serve predictions'
        ],
        'estimated_effort': '8-16 hours (labeling + training)',
        'recommendation': 'Prioritize after report/severity models in production'
    }


@router.post("/classify-report")
async def classify_report(
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
    _text = (body.text if body else None) or text
    _description = (body.description if body else None) or description
    _location = (body.location if body else None) or location
    
    try:
        if not _text or len(_text.strip()) < 3:
            raise HTTPException(status_code=400, detail="Report text too short")
        
        # Try trainable classifier first (directly trained, more recent)
        if report_classifier_trainable and report_classifier_trainable.model is not None:
            import time as _time
            _start = _time.time()
            result = report_classifier_trainable.classify(_text, _description, _location)
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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict-severity")
async def predict_severity(
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
    # Support both JSON body and query params
    _text = (body.text if body else None) or text
    _description = (body.description if body else None) or description
    _trapped = (body.trapped_persons if body else None) or trapped_persons
    _area = (body.affected_area_km2 if body else None) or affected_area_km2
    _pop = (body.population_affected if body else None) or population_affected
    _hazard = (body.hazard_type if body else None) or hazard_type
    
    try:
        if not _text or len(_text.strip()) < 3:
            raise HTTPException(status_code=400, detail="Report text required")
        
        # Use the trainable severity predictor (direct) which has the latest model
        import time as _time
        _start = _time.time()
        result = severity_predictor_direct.predict(
            text=_text,
            description=_description,
            trapped_persons=_trapped,
            affected_area_km2=_area,
            population_affected=_pop,
            hazard_type=_hazard,
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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/detect-fake")
async def detect_fake(
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
    # Support both JSON body and query params
    _text = (body.text if body else None) or text
    _description = (body.description if body else None) or description
    _reputation = (body.user_reputation if body else None) or user_reputation
    _images = (body.image_count if body else None) or image_count
    _verified = (body.location_verified if body else None) or location_verified
    _source = (body.source_type if body else None) or source_type
    _freq = (body.submission_frequency if body else None) or submission_frequency
    _similar = (body.similar_reports_count if body else None) or similar_reports_count
    
    try:
        if not _text or len(_text.strip()) < 3:
            raise HTTPException(status_code=400, detail="Report text required")
        
        if not fake_detector_trainable:
            raise HTTPException(
                status_code=503,
                detail="Fake detector not initialized. Restart AI engine."
            )
        
        result = fake_detector_trainable.detect(
            text=_text,
            description=_description,
            user_reputation=_reputation,
            image_count=_images,
            location_verified=_verified,
            source_type=_source,
            submission_frequency=_freq,
            similar_reports_count=_similar
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
        raise HTTPException(status_code=500, detail=str(e))


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
        "description": "Sovereign-grade multi-hazard environmental intelligence platform",
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
        },
        "documentation": "/docs"
    }


# ═══════════════════════════════════════════════════════════════════════════════
# §  MODEL GOVERNANCE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/models")
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/models/{model_name}/versions")
async def list_model_versions(model_name: str, limit: int = 20):
    """List all versions for a specific model."""
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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/models/rollback")
async def rollback_model(model_name: str, target_version: Optional[str] = None):
    """
    Roll back a model to its previous stable version.
    If target_version is not specified, rolls back to the most recent archived version.
    """
    try:
        result = await governance.rollback(model_name, target_version)

        if result.get("status") == "error":
            raise HTTPException(status_code=404, detail=result["message"])

        # Reload the model in memory after rollback
        if result.get("status") == "rolled_back":
            to_version = result.get("to_version", "")
            await _reload_model_after_rollback(model_name, to_version)

        logger.success(f"Rollback: {model_name} → {result.get('to_version')}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rollback failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


# ═══════════════════════════════════════════════════════════════════════════════
# §  DRIFT DETECTION ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/drift/check")
async def check_drift(model_name: Optional[str] = None, hours: int = 24):
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
        else:
            results = await drift_detector.check_all_models()
            return {
                "models_checked": len(results),
                "drift_found": sum(1 for r in results if r.get("drift_detected")),
                "results": results,
                "checked_at": datetime.utcnow().isoformat(),
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Drift check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predictions/{prediction_id}/feedback")
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predictions/stats")
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
        raise HTTPException(status_code=500, detail=str(e))
