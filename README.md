# AEGIS — Advanced Emergency Geospatial Intelligence System

AI-powered, local-first disaster response platform with real-time geospatial hazard prediction, citizen emergency reporting, operator command centre, and multi-channel alerting.

**BSc Honours Project · CM4134 · Robert Gordon University · 2026**  
**Author:** Happiness Ada Lazarus (2238282) · Supervisor: Shabana Mahmood

---

## Repository Layout

```
aegis-v6-fullstack/
├── aegis-v6/          ← Main system (see aegis-v6/README.md)
│   ├── server/        ← Express + TypeScript API (Node 20, port 3001)
│   ├── client/        ← React + Vite + TypeScript UI (port 5173 / 80)
│   ├── ai-engine/     ← Python FastAPI ML service (port 8000)
│   └── docker-compose.yml
└── aegis-prototype/   ← Legacy standalone UI prototype (archived, not deployed)
```

## Quick Links

| Resource | URL |
|---|---|
| Development setup | [aegis-v6/README.md](aegis-v6/README.md) |
| Client architecture | [aegis-v6/client/ARCHITECTURE.md](aegis-v6/client/ARCHITECTURE.md) |
| Backend service layer | [aegis-v6/docs/backend-service-layer.md](aegis-v6/docs/backend-service-layer.md) |
| Environment template | [aegis-v6/server/.env.example](aegis-v6/server/.env.example) |
| Load tests | [aegis-v6/load-tests/README.md](aegis-v6/load-tests/README.md) |
| Disaster recovery | [aegis-v6/scripts/dr/](aegis-v6/scripts/dr/) |

## System Overview

AEGIS is a full-stack emergency management platform designed for regional disaster response:

- **Citizens** submit georeferenced incident reports, activate SOS beacons, receive multilingual push/SMS/Telegram alerts, and access preparedness guides
- **Operators** monitor live incidents on a PostGIS-backed map, manage alerts, view AI predictions, and access detailed analytics
- **AI Engine** runs 10 hazard-specific ML predictors (flood, wildfire, heatwave, drought, landslide, severe storm, power outage, water supply, infrastructure damage, public safety) locally via Ollama with cloud fallbacks

### Technology Stack

| Layer | Technology |
|---|---|
| Backend | Express 4 + TypeScript, Node 20, `express-rate-limit`, JWT RS256, bcrypt 12r |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, Leaflet, i18next (9 languages) |
| AI Engine | Python 3.11 + FastAPI + scikit-learn + XGBoost + Ollama |
| Database | PostgreSQL 16 + PostGIS + pgvector |
| Cache | Redis (ioredis) with LRU in-memory fallback |
| Real-time | Socket.IO 4 |
| Observability | Prometheus + Grafana + pino logger + Sentry |
| Auth | JWT access tokens (15 min) + httpOnly refresh rotation, TOTP 2FA, WebAuthn, HIBP |
| Notifications | SMTP, Twilio SMS/WhatsApp, Telegram Bot, Web Push (VAPID) |
| LLM | Ollama (qwen3:8b local-first) → Gemini / Groq / OpenRouter fallback |
| Infrastructure | Docker Compose, Nginx, certbot (Let's Encrypt), n8n workflow automation |

## Licence

See [LICENSE](LICENSE).
