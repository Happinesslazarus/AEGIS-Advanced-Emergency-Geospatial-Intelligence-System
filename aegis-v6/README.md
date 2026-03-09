# AEGIS v6 — Advanced Emergency Geospatial Intelligence System

Full-stack AI-powered disaster response platform with PostgreSQL + PostGIS spatial database, real-time citizen reporting, multilingual support, and operator dashboards.

## Quick Start

```bash
# 1. Setup PostgreSQL database (see SETUP.md for details)
createdb aegis
psql -d aegis -c "CREATE EXTENSION postgis; CREATE EXTENSION \"uuid-ossp\";"

# 2. Configure environment
cd server && cp .env.example .env
# Edit .env with your PostgreSQL password

# 3. Install dependencies
cd .. && npm install && cd server && npm install && cd ../client && npm install && cd ..

# 4. Create tables and seed data
cd server && npm run db:setup && cd ..

# 5. Run the application
npm run dev
```

Open http://localhost:5173 | Admin login: admin@aegis.gov.uk / AegisAdmin2026!

## Features

- Citizen emergency reporting with 6-step wizard and photo upload
- PostgreSQL + PostGIS spatial database with 30 seed reports across Scotland
- JWT authentication with bcrypt password hashing and profile photo upload
- AI confidence scoring with explainable reasoning
- AI Transparency Dashboard: model metrics, confusion matrix, feature importance
- Interactive Leaflet map with flood risk zone visualisation
- Real-time SEPA river gauge data (live API)
- OpenWeatherMap integration (live API with free key)
- Multilingual support: 9 languages including Arabic and Urdu (RTL)
- AI chatbot with intent detection responding in user's selected language
- WCAG 2.1 AA accessibility: 7 modes including screen reader, high contrast, dyslexia-friendly
- Community mutual aid system
- Emergency preparedness training with interactive scenarios
- PWA support (installable on mobile)
- CSV/JSON data export for operators
- Activity audit log tracking all operator actions
- QGIS GeoJSON plug-and-play integration for SEPA flood maps

## Author

Happiness Ada Lazarus (2238282) — CM4134 Honours Project — Robert Gordon University
