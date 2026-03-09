"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Main FastAPI Application
 Sovereign-grade multi-hazard environmental intelligence platform
═══════════════════════════════════════════════════════════════════════════════

This is the core FastAPI application that serves AI prediction requests.

Architecture:
- Modular hazard prediction modules
- Region-agnostic feature engineering
- Model versioning and registry
- Strict API contracts
- Production-ready error handling
- Monitoring and logging
"""

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from loguru import logger
import sys
from typing import Dict, List, Any
from datetime import datetime

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Handles startup and shutdown logic.
    """
    logger.info("Starting AEGIS AI Engine...")
    logger.info(f"Environment: {settings.ENV}")
    logger.info(f"Region: {settings.PRIMARY_REGION}")
    
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
    
    yield
    
    # Cleanup on shutdown
    logger.info("Shutting down AEGIS AI Engine...")
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
    Health check endpoint for monitoring and load balancers.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
        "models_loaded": model_registry.count_models(),
        "environment": settings.ENV
    }

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
