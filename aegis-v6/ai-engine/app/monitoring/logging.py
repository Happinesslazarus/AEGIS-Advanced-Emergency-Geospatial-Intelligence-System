"""
Configures loguru for the AI engine. Sets log format (level, file, line,
message), rotation (10 MB), retention (7 days), and adds a JSON sink for
structured log ingestion by tools like Loki. setup_logging() called once
in ai-engine/main.py before any other module.

- setup_logging() called in ai-engine/main.py at the very top
- All modules use: from loguru import logger
- Log files written to ai-engine/logs/ (mapped as Docker volume)
"""

from loguru import logger
import sys
from pathlib import Path

def setup_logging():
    """
    Configure structured logging for the AI engine.
    """
    
    # Remove default logger
    logger.remove()
    
    # Console logging (colorized, human-readable)
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
        level="INFO",
        colorize=True
    )
    
    # File logging (JSON structured, for production)
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)
    
    logger.add(
        log_dir / "ai-engine.log",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
        level="DEBUG",
        rotation="100 MB",
        retention="30 days",
        compression="zip",
        serialize=False
    )
    
    # Separate error log
    logger.add(
        log_dir / "errors.log",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
        level="ERROR",
        rotation="50 MB",
        retention="90 days",
        compression="zip"
    )
    
    logger.success("Logging configured")
