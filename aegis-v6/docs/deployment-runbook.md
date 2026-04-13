# AEGIS v6 — Deployment Runbook

Operational guide for deploying, scaling, monitoring, and recovering
the AEGIS platform in staging and production environments.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [First-Time Deployment](#first-time-deployment)
4. [Routine Deployment](#routine-deployment)
5. [Scaling](#scaling)
6. [Monitoring & Alerting](#monitoring--alerting)
7. [Backup & Restore](#backup--restore)
8. [Rollback](#rollback)
9. [Troubleshooting](#troubleshooting)
10. [Disaster Recovery](#disaster-recovery)

---

## Prerequisites

| Component | Minimum Version | Purpose |
|-----------|-----------------|---------|
| Docker | 24+ | Container runtime |
| Docker Compose | v2.20+ | Service orchestration |
| PostgreSQL | 16 (via PostGIS image) | Primary database |
| Redis | 7 | Cache & rate limiting |
| Node.js | 20 LTS | Server runtime |
| Python | 3.11+ | AI engine |
| nginx | 1.25+ | Reverse proxy (in client image) |

**Required secrets** (must be configured before first deploy):

```bash
DB_PASSWORD          # PostgreSQL password (min 16 chars)
JWT_SECRET           # JWT signing key (min 32 chars, unique)
REFRESH_TOKEN_SECRET # Refresh token key (separate from JWT_SECRET)
INTERNAL_API_KEY     # Server ↔ AI engine key (min 16 chars)
N8N_WEBHOOK_SECRET   # Webhook auth secret
TWO_FACTOR_ENCRYPTION_KEY  # 64 hex chars for TOTP encryption
API_SECRET_KEY       # AI engine API key
```

---

## Environment Variables

Full list in `aegis-v6/docker-compose.yml`. Critical variables:

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `JWT_SECRET` | Yes | — | Must differ from REFRESH_TOKEN_SECRET |
| `AEGIS_REGION` | No | `scotland` | Active region: `scotland`, `england`, `default` |
| `REDIS_ENABLED` | No | `true` | Set `false` to disable Redis cache |
| `SMTP_HOST` | Prod | — | Email delivery (security alerts, notifications) |
| `GEMINI_API_KEY` | Prod | — | Google Gemini for AI chat |
| `GROQ_API_KEY` | Prod | — | Groq LLM inference |
| `HF_API_KEY` | Prod | — | HuggingFace models |

---

## First-Time Deployment

### 1. Clone & configure

```bash
git clone <repo-url> aegis-v6-fullstack
cd aegis-v6-fullstack/aegis-v6

# Copy and fill environment template
cp .env.example .env
# Edit .env with all required secrets
```

### 2. Start services

```bash
# Development (with seed data)
docker compose up -d

# Production (HTTPS, no seed data)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 3. Verify startup

```bash
# Health checks
curl http://localhost:3001/api/health       # → { "status": "ok" }
curl http://localhost:8000/health            # → AI engine health
curl http://localhost:3002/api/health        # → Grafana health

# Check all containers are healthy
docker compose ps
```

### 4. Create initial admin

```bash
# Option 1: Environment variables (docker-compose handles it)
INITIAL_ADMIN_EMAIL=admin@example.com \
INITIAL_ADMIN_PASSWORD='<strong-password>' \
docker compose up seed-admin

# Option 2: Manual via API after startup
curl -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<password>","displayName":"Admin"}'
```

### 5. SSL certificates (production)

```bash
# First-time cert acquisition (replace domain)
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot -d aegis.example.com

# Restart nginx to pick up certs
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart client
```

---

## Routine Deployment

### Update to latest code

```bash
cd aegis-v6-fullstack
git pull origin main

cd aegis-v6

# Rebuild only changed services
docker compose build server client ai

# Rolling restart (zero-downtime with health checks)
docker compose up -d --no-deps server
docker compose up -d --no-deps client
docker compose up -d --no-deps --profile ai ai

# Run any new migrations
docker compose up migration
```

### Verify after deploy

```bash
# API health
curl -sf http://localhost:3001/api/health | jq .

# Check logs for errors
docker compose logs --since 5m server | grep -i error
docker compose logs --since 5m ai | grep -i error

# Verify database migrations applied
docker compose exec db psql -U postgres -d aegis \
  -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"
```

---

## Scaling

### Horizontal scaling (multiple server instances)

```bash
# Scale server to 3 replicas
docker compose up -d --scale server=3

# Add a load balancer (nginx upstream)
# In nginx.conf:
#   upstream aegis_api {
#     server server_1:3001;
#     server server_2:3001;
#     server server_3:3001;
#   }
```

### Vertical scaling (resource limits)

Edit `docker-compose.yml` memory/CPU limits:

```yaml
server:
  mem_limit: 1g    # increase from 512m
  cpus: 2.0        # increase from 1.0
```

### Database scaling

```bash
# Increase shared_buffers (edit postgresql.conf or env)
docker compose exec db psql -U postgres -c "ALTER SYSTEM SET shared_buffers = '512MB';"
docker compose restart db

# Add read replica (for high-read scenarios)
# Configure REPLICA_DATABASE_URL in server env
```

---

## Monitoring & Alerting

### Access dashboards

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | `http://localhost:3002` | `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` |
| Prometheus | `http://localhost:9090` (uncomment port) | None |
| API Docs | `http://localhost:3001/api/docs` | None |

### Pre-built Grafana dashboards

Located in `docker/grafana/dashboards/`:

| Dashboard | Purpose |
|-----------|---------|
| `aegis-overview.json` | High-level system status, request rates, error rates |
| `aegis-system-health.json` | CPU, memory, disk, container health |
| `aegis-ai-health.json` | AI engine latency, model inference times, prediction accuracy |
| `aegis-alerts-delivery.json` | Alert broadcast success rates by channel |
| `aegis-distress.json` | SOS beacon metrics, response times |
| `aegis-cron.json` | Scheduled job execution history |

### Alert rules

Prometheus alert rules in `docker/prometheus/rules.yml`:

| Alert | Condition | Severity |
|-------|-----------|----------|
| AegisServerDown | Server unreachable for >1 min | Critical |
| AegisAIEngineDown | AI engine unreachable for >2 min | Critical |
| HighErrorRate | 5xx rate > 5% for 3 min | Warning |
| HighLatencyP95 | p95 latency > 5s for 5 min | Warning |

Alerts route to Alertmanager → configured channels (email/Slack/webhook).

---

## Backup & Restore

### Automated database backup

```bash
# Run backup script (outputs to backups/db/)
./scripts/db-backup.sh

# Or manual pg_dump
docker compose exec db pg_dump -U postgres -Fc aegis > backup_$(date +%Y%m%d_%H%M).dump
```

### Restore from backup

```bash
# Stop server to prevent writes during restore
docker compose stop server ai

# Restore
docker compose exec -T db pg_restore -U postgres -d aegis --clean < backup_20260408_1200.dump

# Restart
docker compose start server ai
```

### Redis cache

Redis is ephemeral (cache only). No backup needed — it rebuilds on server restart.

### Uploaded files

```bash
# Backup uploads volume
docker compose exec server tar czf /tmp/uploads.tar.gz /app/uploads
docker cp $(docker compose ps -q server):/tmp/uploads.tar.gz ./backups/
```

---

## Rollback

### Quick rollback (to previous image)

```bash
# Tag current as rollback point
docker tag aegis-server:latest aegis-server:rollback

# Revert to previous commit
git checkout HEAD~1
docker compose build server client ai
docker compose up -d --no-deps server client

# If things go wrong, restore the rollback tag
docker tag aegis-server:rollback aegis-server:latest
docker compose up -d --no-deps server
```

### Database rollback

Database migrations are designed to be additive. If a migration causes issues:

```bash
# Check current migration state
docker compose exec db psql -U postgres -d aegis \
  -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 3;"

# Restore from last known good backup (see Backup section)
```

---

## Troubleshooting

### Common issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ECONNREFUSED` on port 3001 | Server not started | `docker compose up -d server` |
| `role "postgres" does not exist` | DB not initialized | `docker compose up -d db` and wait for health |
| `JWT_SECRET must be set` | Missing .env | Copy `.env.example` → `.env` and fill secrets |
| AI engine returns 503 | AI container not in active profile | `docker compose --profile ai up -d ai` |
| Flood warnings empty | Region adapters not configured | Check `AEGIS_REGION` env var |
| Email delivery failed | SMTP not configured | Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` |

### Log inspection

```bash
# Server logs (last 100 lines)
docker compose logs --tail 100 server

# AI engine logs
docker compose logs --tail 100 ai

# Database logs
docker compose logs --tail 50 db

# All services, follow mode
docker compose logs -f
```

### Database debugging

```bash
# Connect to psql
docker compose exec db psql -U postgres -d aegis

# Check active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'aegis';

# Check table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

---

## Disaster Recovery

### Complete rebuild from scratch

```bash
# 1. Provision new server with Docker installed
# 2. Clone repo
git clone <repo-url> aegis-v6-fullstack
cd aegis-v6-fullstack/aegis-v6

# 3. Restore .env from secure backup location
cp /secure/backup/.env .

# 4. Start database first
docker compose up -d db
docker compose up migration

# 5. Restore database from latest backup
docker compose exec -T db pg_restore -U postgres -d aegis --clean < latest-backup.dump

# 6. Start all services
docker compose up -d

# 7. Verify
curl http://localhost:3001/api/health
```

### RTO / RPO targets

| Metric | Target | Strategy |
|--------|--------|----------|
| RPO (data loss) | < 1 hour | Automated hourly pg_dump |
| RTO (recovery time) | < 30 minutes | Docker Compose rebuild from backup |
| Monitoring detection | < 2 minutes | Prometheus alerts → Alertmanager |

---

## Contact

- **Lead Engineer**: Check `CODEOWNERS` file
- **On-call**: See Grafana alert routing configuration
- **Incident response**: Follow the runbook above, then escalate via configured channels
