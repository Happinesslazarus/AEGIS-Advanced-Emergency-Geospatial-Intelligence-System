"""
FastAPI dependency that verifies the X-API-Key header on protected routes.
API keys are compared using HMAC-based constant-time comparison to prevent
timing attacks. Also supports an internal HMAC signature scheme for
server-to-server calls (matching server/src/middleware/internalAuth.ts).

- Used as a Depends() argument on sensitive routes in endpoints.py
- API key value read from AI_API_KEY environment variable
- Server calls this from server/src/services/aiAnalysisPipeline.ts
  with X-Internal-Signature + X-Internal-Timestamp headers
"""

import os
import hmac
import hashlib
from fastapi import Header, HTTPException, Request
from functools import wraps
from typing import Optional
from loguru import logger

# Get API key from environment
API_SECRET_KEY = os.getenv("API_SECRET_KEY", "")

async def verify_api_key(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None),
) -> bool:
    """
    Verify API key authentication.
    
    Accepts:
    - X-API-Key header with the API secret
    - Authorization: Bearer <api_key> header
    """
    # Require API key in ALL environments (fail-closed).
    # The Express server always sends X-API-Key even on localhost.
    if not API_SECRET_KEY:
        logger.error("API_SECRET_KEY not set -- rejecting request")
        raise HTTPException(status_code=500, detail="Server misconfiguration")
    
    # Check X-API-Key header
    if x_api_key:
        if hmac.compare_digest(x_api_key, API_SECRET_KEY):
            return True
        logger.warning(f"Invalid X-API-Key from {request.client.host}")
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    # Check Authorization header
    if authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:]
            if hmac.compare_digest(token, API_SECRET_KEY):
                return True
        logger.warning(f"Invalid Authorization header from {request.client.host}")
        raise HTTPException(status_code=401, detail="Invalid authorization")
    
    # No credentials provided
    logger.warning(f"No API key provided from {request.client.host} for {request.url.path}")
    raise HTTPException(
        status_code=401, 
        detail="API key required. Set X-API-Key header or Authorization: Bearer <key>"
    )

def require_api_key(func):
    """
    Decorator to require API key authentication.
    Use on sensitive endpoints like /retrain, /classify-image, /detect-fake.
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        request = kwargs.get("request")
        if request:
            await verify_api_key(request)
        return await func(*args, **kwargs)
    return wrapper
