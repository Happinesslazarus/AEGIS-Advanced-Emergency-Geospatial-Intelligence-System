"""Shared slowapi rate-limiter instance — imported by main.py and endpoints.py."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
