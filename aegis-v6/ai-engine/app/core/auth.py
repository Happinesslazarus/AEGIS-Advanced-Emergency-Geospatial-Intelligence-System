"""
AEGIS AI Engine — API Authentication Middleware

Protects sensitive AI endpoints from unauthorized access.
Uses API key authentication with optional internal IP bypass for dev.
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

# Allow internal network in development
INTERNAL_NETWORKS = [
    "127.0.0.1",
    "::1",
    "localhost",
]

def is_internal_ip(request: Request) -> bool:
    """Check if request is from internal network."""
    client_host = request.client.host if request.client else None
    if not client_host:
        return False
    
    for net in INTERNAL_NETWORKS:
        if client_host == net or client_host.startswith("10.") or \
           client_host.startswith("172.") or client_host.startswith("192.168."):
            return True
    return False

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
    - Internal IP bypass in development mode
    """
    env = os.getenv("ENV", "development")
    
    # Development mode: allow internal IPs without auth
    if env != "production" and is_internal_ip(request):
        logger.debug(f"Internal IP bypass for {request.client.host}")
        return True
    
    # Production mode: require API key
    if not API_SECRET_KEY:
        if env == "production":
            logger.error("API_SECRET_KEY not set in production!")
            raise HTTPException(status_code=500, detail="Server misconfiguration")
        # Dev mode without key: allow all (with warning)
        logger.warning("API_SECRET_KEY not set - allowing all requests (dev mode)")
        return True
    
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
