"""
File: rate_limit.py

What this file does:
SlowAPI (Flask-Limiter for FastAPI) instance used to apply per-IP rate
limits on prediction endpoints. Default limit: 120 requests per minute.
Mounted as middleware in main.py and applied per-route with @limiter.limit.

How it connects:
- limiter instance mounted in ai-engine/main.py as SlowAPIMiddleware
- Applied per-endpoint with @limiter.limit("N/minute") in endpoints.py
- Key function: client IP address (get_remote_address)
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
