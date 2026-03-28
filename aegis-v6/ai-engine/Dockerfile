#  AEGIS AI ENGINE — Dockerfile
#  Production-ready containerization

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for caching)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install curl for healthcheck (lighter than spawning Python)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create non-root user (CIS Docker Benchmark)
RUN groupadd --system app && useradd --system --gid app --create-home app

# Copy application code
COPY --chown=app:app . .

# Create necessary directories with correct ownership
RUN mkdir -p logs model_registry feature_store model_cache && chown -R app:app logs model_registry feature_store model_cache

# Switch to non-root user
USER app

# Expose port
EXPOSE 8000

# Health check — uses curl instead of spawning a full Python interpreter
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
