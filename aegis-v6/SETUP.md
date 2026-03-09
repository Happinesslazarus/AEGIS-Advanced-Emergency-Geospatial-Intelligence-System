# AEGIS v6 — Setup Instructions

## Prerequisites

Install these before starting:

1. **Node.js** (v18 or later) — https://nodejs.org
2. **PostgreSQL** (v14 or later) — https://www.postgresql.org/download/
3. **PostGIS** extension — https://postgis.net/install/

### Installing PostgreSQL + PostGIS

**Windows:**
- Download PostgreSQL from https://www.postgresql.org/download/windows/
- During installation, check "Stack Builder" and install PostGIS from spatial extensions
- Default password is what you set during install (remember this!)

**macOS:**
```
brew install postgresql postgis
brew services start postgresql
```

**Linux (Ubuntu):**
```
sudo apt install postgresql postgresql-contrib postgis
sudo systemctl start postgresql
```

---

## Step 1: Create the Database

Open a terminal and run:

```bash
# Connect to PostgreSQL (Windows: use pgAdmin or psql from Start Menu)
psql -U postgres

# Inside psql, create the database:
CREATE DATABASE aegis;

# Connect to it:
\c aegis

# Enable PostGIS:
CREATE EXTENSION postgis;
CREATE EXTENSION "uuid-ossp";

# Exit psql:
\q
```

---

## Step 2: Configure Environment

```bash
# Navigate to the server directory
cd server

# Copy the example environment file
cp .env.example .env

# Edit .env with your PostgreSQL credentials:
# DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/aegis
# JWT_SECRET=change-this-to-any-random-string
# WEATHER_API_KEY=your-openweathermap-key (optional, free at openweathermap.org)
```

---

## Step 3: Install Dependencies

```bash
# From the root aegis-v6 directory:
npm install

# Install server dependencies:
cd server && npm install

# Install client dependencies:
cd ../client && npm install

# Go back to root:
cd ..
```

---

## Step 4: Setup Database Tables and Seed Data

```bash
cd server
npm run db:setup
```

This creates all tables and inserts 30 sample reports, 5 alerts, and 3 AI model metrics.

**Expected output:**
```
[Setup] Connected to PostgreSQL successfully
[Setup] Schema created successfully
[Setup] Seed data inserted successfully
[Setup] Database ready:
  Reports:    30
  Operators:  1
  Alerts:     5
  AI Models:  3
[Setup] Default admin: admin@aegis.gov.uk / AegisAdmin2026!
```

---

## Step 5: Run the Application

```bash
# From the root directory, start both servers:
npm run dev
```

This starts:
- **Express API** on http://localhost:3001
- **React frontend** on http://localhost:5173

Open **http://localhost:5173** in your browser.

---

## Default Login

- **Email:** admin@aegis.gov.uk
- **Password:** AegisAdmin2026!

---

## Adding QGIS Flood Data (Plug and Play)

After exporting GeoJSON from QGIS:

1. Place files in `client/public/data/`:
   - `flood_river_high.geojson`
   - `flood_river_medium.geojson`
   - `flood_coastal_high.geojson`
   - etc.

2. To import into PostGIS for spatial queries:
```bash
# Use ogr2ogr (comes with GDAL/PostGIS)
ogr2ogr -f "PostgreSQL" PG:"dbname=aegis user=postgres password=YOUR_PASSWORD" \
  client/public/data/flood_river_high.geojson \
  -nln flood_zones -append
```

The map and AI confidence scoring will automatically use this data.

---

## Weather API (Optional)

1. Create a free account at https://openweathermap.org
2. Get your API key from the dashboard
3. Add it to `server/.env`: `WEATHER_API_KEY=your-key-here`
4. Restart the server

Without a key, realistic simulated weather data is shown.

---

## Project Structure

```
aegis-v6/
├── client/                  # React frontend (Vite + TypeScript + Tailwind)
│   ├── src/
│   │   ├── components/      # UI components
│   │   │   ├── admin/       # Operator dashboard components
│   │   │   ├── citizen/     # Public-facing components
│   │   │   └── shared/      # Shared components (map, weather, etc.)
│   │   ├── contexts/        # React context providers
│   │   ├── data/            # Static data and configuration
│   │   ├── hooks/           # Custom React hooks
│   │   ├── pages/           # Page-level components
│   │   ├── styles/          # CSS and Tailwind config
│   │   ├── types/           # TypeScript type definitions
│   │   └── utils/           # Utility functions (API, i18n, chatbot)
│   └── public/
│       └── data/            # QGIS GeoJSON exports go here
│
├── server/                  # Express API (Node.js + TypeScript)
│   ├── src/
│   │   ├── middleware/      # Auth (JWT) and file upload (Multer)
│   │   ├── models/          # Database connection pool
│   │   ├── routes/          # API endpoint handlers
│   │   └── utils/           # Database setup scripts
│   ├── sql/                 # PostgreSQL schema and seed data
│   └── uploads/             # Uploaded photos and avatars
│
└── package.json             # Root monorepo config
```

---

## Troubleshooting

**"Cannot connect to PostgreSQL"**
- Make sure PostgreSQL is running: `pg_isready`
- Check your DATABASE_URL in server/.env

**"PostGIS extension not found"**
- Install PostGIS for your platform
- Run `CREATE EXTENSION postgis;` in psql connected to the aegis database

**"Port 3001 already in use"**
- Change PORT in server/.env to another number

**API returns 401 Unauthorized**
- Your JWT token may have expired (24h). Log in again.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + Vite |
| Mapping | Leaflet + OpenStreetMap |
| Backend | Express.js + Node.js |
| Database | PostgreSQL 14+ with PostGIS |
| Auth | JWT (jsonwebtoken) + bcrypt |
| File Upload | Multer |
| Icons | Lucide React (SVG) |
| i18n | Custom 9-language system (incl. RTL) |

---

**Author:** Happiness Ada Lazarus (2238282)
**Module:** CM4134 Honours Project
**Supervisor:** David Lonie
**University:** Robert Gordon University
