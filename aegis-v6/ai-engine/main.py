"""
 AEGIS AI ENGINE — Main FastAPI Application
 Sovereign-grade multi-hazard environmental intelligence platform

This is the core FastAPI application that serves AI prediction requests.

Architecture:
- Modular hazard prediction modules
- Region-agnostic feature engineering
- Model versioning and registry
- Strict API contracts
- Production-ready error handling
- Monitoring and logging
"""

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from loguru import logger
import sys
import os
import shutil
import asyncio
from typing import Dict, List, Any
from datetime import datetime

# Rate limiting (slowapi — backed by in-process memory limiter)
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.core.rate_limit import limiter

# Core modules
from app.core.config import settings
from app.core.model_registry import ModelRegistry
from app.core.feature_store import FeatureStore
from app.api import endpoints
from app.monitoring.metrics import setup_metrics
from app.monitoring.logging import setup_logging

# Initialize logging
setup_logging()

# Initialize model registry (global singleton)
model_registry = ModelRegistry(settings.MODEL_REGISTRY_PATH)
feature_store = FeatureStore(settings.FEATURE_STORE_PATH)

# Auto-retrain on drift
async def _drift_check_loop():
    """
    Background task: periodically checks ALL active models for drift.
    If drift is detected on any model, triggers automatic retraining.
    Runs every DRIFT_CHECK_INTERVAL seconds (default: 3600 = 1h).
    """
    from app.core.governance import drift_detector, governance
    await asyncio.sleep(60)  # initial delay to let app fully start

    while True:
        try:
            logger.info("[DRIFT-SCHEDULER] Running drift check on all active models...")
            results = await drift_detector.check_all_models()
            drifted = [r for r in results if r.get("drift_detected")]

            if drifted:
                logger.warning(f"[DRIFT-SCHEDULER] Drift detected on {len(drifted)} model(s): "
                               f"{[d['model_name'] for d in drifted]}")

                for d in drifted:
                    model_name = d["model_name"]
                    signals = d.get("signals", [])
                    critical = [s for s in signals if s.get("severity") == "critical"]

                    # Log drift event to model_governance audit trail
                    try:
                        import asyncpg
                        conn = await asyncpg.connect(drift_detector.db_url)
                        try:
                            await conn.execute("""
                                INSERT INTO model_governance_audit
                                    (model_name, action, details, performed_by)
                                VALUES ($1, 'drift_detected', $2, 'auto-scheduler')
                            """, model_name, str({
                                "signal_count": len(signals),
                                "critical_signals": len(critical),
                                "signals": signals[:3],  # max 3 for log size
                            }))
                        except Exception:
                            pass  # table may not exist yet
                        finally:
                            await conn.close()
                    except Exception:
                        pass

                    # Trigger retraining for critically drifted models
                    if critical:
                        logger.warning(f"[DRIFT-SCHEDULER] CRITICAL drift on '{model_name}' — triggering auto-retrain")
                        try:
                            from app.api.endpoints import (
                                severity_predictor_direct,
                                report_classifier_trainable,
                                fake_detector_trainable,
                            )
                            db_url = settings.DATABASE_URL
                            retrain_results = {}
                            if severity_predictor_direct:
                                retrain_results["severity"] = await severity_predictor_direct.async_train(db_url)
                            if report_classifier_trainable:
                                retrain_results["classifier"] = await report_classifier_trainable.async_train(db_url)
                            if fake_detector_trainable:
                                retrain_results["fake_detector"] = await fake_detector_trainable.async_train(db_url)
                            logger.success(f"[DRIFT-SCHEDULER] Auto-retrain complete for '{model_name}': {list(retrain_results.keys())}")
                        except Exception as e:
                            logger.error(f"[DRIFT-SCHEDULER] Auto-retrain failed for '{model_name}': {e}")
                    else:
                        logger.info(f"[DRIFT-SCHEDULER] Non-critical drift on '{model_name}' — monitoring only")
            else:
                logger.info(f"[DRIFT-SCHEDULER] No drift detected across {len(results)} model(s)")

        except asyncio.CancelledError:
            logger.info("[DRIFT-SCHEDULER] Shutting down drift scheduler")
            raise
        except Exception as e:
            logger.error(f"[DRIFT-SCHEDULER] Error in drift check loop: {e}")

        await asyncio.sleep(settings.DRIFT_CHECK_INTERVAL)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Handles startup and shutdown logic.
    """
    logger.info("Starting AEGIS AI Engine...")
    logger.info(f"Environment: {settings.ENV}")
    logger.info(f"Region: {settings.PRIMARY_REGION}")

    # Initialize Sentry error tracking (only when DSN is configured)
    if settings.ENABLE_SENTRY and settings.SENTRY_DSN:
        try:
            import sentry_sdk
            sentry_sdk.init(
                dsn=settings.SENTRY_DSN,
                environment=settings.ENV,
                release="aegis-ai-engine@1.0.0",
                traces_sample_rate=0.1 if settings.ENV == "production" else 1.0,
            )
            sentry_sdk.set_tag("service", "ai-engine")
            logger.success("Sentry error tracking enabled")
        except Exception as e:
            logger.warning(f"Sentry initialization failed: {e}")
    else:
        logger.info("Sentry: DSN not configured — error tracking disabled")

    # Load models on startup
    try:
        await model_registry.load_all_models()
        logger.success(f"Loaded {model_registry.count_models()} models successfully")
    except Exception as e:
        logger.error(f"Failed to load models: {e}")
        # Continue anyway - models can be loaded on-demand
    
    # Initialize feature store
    try:
        await feature_store.initialize()
        logger.success("Feature store initialized")
    except Exception as e:
        logger.warning(f"Feature store initialization warning: {e}")
    
    logger.success("AEGIS AI Engine ready")
    
    # Start background drift-check scheduler (auto-retrain on drift)
    drift_task = None
    if settings.ENABLE_DRIFT_DETECTION:
        drift_task = asyncio.create_task(_drift_check_loop())
        logger.info(f"Drift auto-retrain scheduler started (interval: {settings.DRIFT_CHECK_INTERVAL}s)")
    
    yield
    
    # Cleanup on shutdown
    logger.info("Shutting down AEGIS AI Engine...")
    if drift_task:
        drift_task.cancel()
        try:
            await drift_task
        except asyncio.CancelledError:
            pass
    await model_registry.cleanup()
    await feature_store.cleanup()
    logger.success("Shutdown complete")

# Create FastAPI application
app = FastAPI(
    title="AEGIS AI Engine",
    description="Sovereign-grade multi-hazard environmental intelligence platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Rate limiting middleware
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup monitoring
if settings.ENABLE_PROMETHEUS:
    setup_metrics(app)

# Include routers
app.include_router(endpoints.router, prefix="/api", tags=["predictions"])

# Health check endpoint
@app.get("/health")
async def health_check():
    """
    Deep health check for Kubernetes readiness/liveness probes.
    Checks: model registry, disk space, (optional) DB connectivity.
    """
    checks: Dict[str, Any] = {}
    overall_ok = True

    # 1. Model registry
    try:
        count = model_registry.count_models()
        checks["model_registry"] = {"status": "ok", "models_loaded": count}
    except Exception as e:
        checks["model_registry"] = {"status": f"error: {e}"}
        overall_ok = False

    # 2. Disk space (feature store + model registry dirs)
    try:
        fs_usage = shutil.disk_usage(settings.FEATURE_STORE_PATH if os.path.exists(settings.FEATURE_STORE_PATH) else "/")
        free_gb = fs_usage.free / (1024 ** 3)
        if free_gb < 0.5:
            checks["disk"] = {"status": "warning", "free_gb": round(free_gb, 2)}
        else:
            checks["disk"] = {"status": "ok", "free_gb": round(free_gb, 2)}
    except Exception as e:
        checks["disk"] = {"status": f"error: {e}"}

    # 3. Optional DB connectivity (only if DATABASE_URL configured)
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            import asyncpg
            conn = await asyncio.wait_for(asyncpg.connect(db_url), timeout=3.0)
            await conn.execute("SELECT 1")
            await conn.close()
            checks["database"] = {"status": "ok"}
        except Exception as e:
            checks["database"] = {"status": f"error: {e}"}
            overall_ok = False

    status_code = 200 if overall_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if overall_ok else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "version": "1.0.0",
            "environment": settings.ENV,
            "checks": checks,
        },
    )

# Root endpoint
@app.get("/")
async def root():
    """
    Root endpoint - API information.
    """
    return {
        "name": "AEGIS AI Engine",
        "version": "1.0.0",
        "status": "operational",
        "documentation": "/docs",
        "health": "/health"
    }

# Exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """
    Global HTTP exception handler.
    """
    logger.error(f"HTTP error: {exc.status_code} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code,
            "timestamp": datetime.utcnow().isoformat()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """
    Global general exception handler.
    """
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc) if settings.DEBUG else "An unexpected error occurred",
            "timestamp": datetime.utcnow().isoformat()
        }
    )

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower()
    )
