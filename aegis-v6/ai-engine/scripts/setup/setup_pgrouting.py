"""
File: setup_pgrouting.py

What this file does:
Sets up the pgRouting extension and road network topology in the AEGIS
PostGIS database.  pgRouting extends PostgreSQL with graph-based routing
algorithms (Dijkstra, A*, Travelling Salesman etc.) which AEGIS uses for:
  - Isochrone generation (drive-time catchment areas around incidents)
  - Evacuation route recommendation
  - Critical network node identification (betweenness centrality)

Steps performed:
  1. Connects to the AEGIS PostgreSQL database
  2. Creates the pgrouting extension (if available)
  3. Downloads the OSM road network for the UK via Overpass API
  4. Imports road network into the road_network table
  5. Runs pgr_createTopology to add source/target node IDs
  6. Optionally schedules a weekly cron to refresh the topology

Glossary:
  pgRouting     = PostgreSQL extension providing 60+ routing and network
                  analysis algorithms; built on PostGIS geometry types
  topology      = a mathematically consistent representation of a road network
                  as a graph of nodes (intersections) and edges (road segments)
  source/target = integer IDs assigned to start/end nodes of each road segment;
                  required by pgr_dijkstra and other routing functions
  cost          = edge traversal time in minutes (derived from OSM speed tags
                  or road class defaults)
  Overpass API  = query API for OpenStreetMap data at overpass-api.de
  osm2pgrouting = C++ converter from OSM XML → pgRouting-ready tables
                  (alternative if you have large datasets)

How it connects:
  Reads from  ← .env or environment variables for DB connection
             ← Overpass API (downloads UK road network)
  Writes to  → road_network table (PostGIS + pgRouting)
  Used by    ← app/services/spatial_analytics.py (pgRouting queries)

Usage:
  python scripts/setup/setup_pgrouting.py
  python scripts/setup/setup_pgrouting.py --bbox "49.5,-8.5,61.0,2.0"
  python scripts/setup/setup_pgrouting.py --only-topology   # skip OSM, just redo topology

Requirements:
  pip install psycopg2-binary python-dotenv requests tqdm
  PostgreSQL must have pgrouting extension available:
    apt install postgresql-16-pgrouting   # Ubuntu/Debian
    or install via pgAdmin / Docker image with pgrouting
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
    from psycopg2 import sql as pgsql
except ImportError:
    sys.exit("Missing: psycopg2-binary\nRun: pip install psycopg2-binary")

try:
    import requests
    from tqdm import tqdm
except ImportError:
    sys.exit("Missing: requests tqdm\nRun: pip install requests tqdm")

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[3] / "server" / ".env")
except ImportError:
    pass  # dotenv optional; fall back to os.environ

# Database connection from environment (same as AEGIS server)
DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://aegis_user:aegis_pass@localhost:5432/aegis"
)

# Overpass API endpoint
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# UK bounding box (south,west,north,east)
DEFAULT_UK_BBOX = "49.5,-8.5,61.0,2.0"

# Road type → default speed (km/h) for travel-time cost calculation
ROAD_SPEEDS: dict[str, int] = {
    "motorway":      120,
    "trunk":         100,
    "primary":        80,
    "secondary":      60,
    "tertiary":       50,
    "residential":    30,
    "service":        20,
    "cycleway":       15,
    "footway":         5,
    "path":            5,
    "unclassified":   40,
}
DEFAULT_SPEED = 40  # km/h


def get_db_conn():
    """Return a psycopg2 connection using DATABASE_URL."""
    return psycopg2.connect(DB_URL)


def check_pgrouting(conn) -> bool:
    """Return True if pgrouting extension is installable."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM pg_available_extensions WHERE name = 'pgrouting'"
        )
        return cur.fetchone() is not None


def install_pgrouting(conn) -> bool:
    """Create pgrouting extension; return True if installed after call."""
    with conn.cursor() as cur:
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pgrouting")
            conn.commit()
            print("  pgRouting extension installed.")
            return True
        except Exception as exc:
            conn.rollback()
            print(f"  Warning: could not install pgrouting: {exc}")
            print("  Spatial analytics will fall back to ORS/circle isochrones.")
            return False


def create_road_network_table(conn) -> None:
    """Create road_network table if it does not exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS road_network (
                id           BIGSERIAL    PRIMARY KEY,
                osm_id       BIGINT,
                road_class   VARCHAR(40),
                name         TEXT,
                source       INTEGER,
                target       INTEGER,
                cost         DOUBLE PRECISION,
                reverse_cost DOUBLE PRECISION,
                one_way      BOOLEAN NOT NULL DEFAULT FALSE,
                geom         GEOMETRY(LineString, 4326)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_road_net_src  ON road_network (source)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_road_net_tgt  ON road_network (target)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_road_net_geo  ON road_network USING GIST (geom)")
        conn.commit()
    print("  road_network table ready.")


def fetch_osm_roads(bbox: str) -> list[dict]:
    """
    Download UK road network from Overpass API as GeoJSON-style dicts.

    bbox format: "south,west,north,east"
    """
    south, west, north, east = bbox.split(",")
    # Overpass QL: fetch all highway ways with geometry in the bounding box
    query = f"""
[out:json][timeout:300];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified"]
     ({south},{west},{north},{east});
);
out body geom;
"""
    print(f"  Querying Overpass API for roads in [{south},{west},{north},{east}] ...")
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=360)
    resp.raise_for_status()
    data = resp.json()
    ways = data.get("elements", [])
    print(f"  Downloaded {len(ways):,} road segments from OSM.")
    return ways


def edge_length_km(geometry: list[dict]) -> float:
    """Approximate length of an OSM way geometry in kilometres using Haversine."""
    import math
    if len(geometry) < 2:
        return 0.0
    total = 0.0
    for i in range(len(geometry) - 1):
        lat1, lon1 = geometry[i]["lat"],    geometry[i]["lon"]
        lat2, lon2 = geometry[i+1]["lat"], geometry[i+1]["lon"]
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        total += R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return total


def import_roads(conn, ways: list[dict], batch_size: int = 500) -> int:
    """Insert road segments into road_network table."""
    inserted = 0
    with conn.cursor() as cur:
        cur.execute("TRUNCATE road_network RESTART IDENTITY")
        conn.commit()

        batch: list[tuple] = []
        for way in tqdm(ways, desc="Importing roads", unit="seg"):
            tags     = way.get("tags", {})
            highway  = tags.get("highway", "unclassified")
            geom_pts = way.get("geometry", [])
            if len(geom_pts) < 2:
                continue

            # Build WKT LineString
            coords = ", ".join(f"{p['lon']} {p['lat']}" for p in geom_pts)
            wkt    = f"LINESTRING({coords})"

            speed_kmh = ROAD_SPEEDS.get(highway, DEFAULT_SPEED)
            length_km = edge_length_km(geom_pts)
            cost_min  = (length_km / speed_kmh) * 60.0  # minutes

            one_way = tags.get("oneway", "no") == "yes"
            rev_cost = 1e9 if one_way else cost_min

            batch.append((
                way.get("id"),
                highway,
                tags.get("name"),
                cost_min,
                rev_cost,
                one_way,
                wkt,
            ))

            if len(batch) >= batch_size:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO road_network
                      (osm_id, road_class, name, cost, reverse_cost, one_way, geom)
                    VALUES %s
                    """,
                    [(r[0], r[1], r[2], r[3], r[4], r[5],
                      f"ST_GeomFromText('{r[6]}', 4326)") for r in batch],
                    template="(%s,%s,%s,%s,%s,%s,%s::geometry)",
                )
                inserted += len(batch)
                batch.clear()

        if batch:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO road_network
                  (osm_id, road_class, name, cost, reverse_cost, one_way, geom)
                VALUES %s
                """,
                [(r[0], r[1], r[2], r[3], r[4], r[5],
                  f"ST_GeomFromText('{r[6]}', 4326)") for r in batch],
                template="(%s,%s,%s,%s,%s,%s,%s::geometry)",
            )
            inserted += len(batch)
        conn.commit()

    print(f"  {inserted:,} road segments imported.")
    return inserted


def build_topology(conn) -> None:
    """
    Run pgr_createTopology to assign source/target node IDs to each edge.
    This is required before any pgRouting routing queries can be executed.
    """
    print("  Building pgRouting topology (this may take several minutes) ...")
    with conn.cursor() as cur:
        # pgr_createTopology args: table, tolerance, geom_col, edge_id_col
        cur.execute(
            "SELECT pgr_createTopology('road_network', 0.00001, 'geom', 'id')"
        )
        conn.commit()
    print("  Topology built — source/target columns populated.")


def verify_topology(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM road_network WHERE source IS NOT NULL AND target IS NOT NULL")
        routed = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM road_network")
        total  = cur.fetchone()[0]
    pct = (routed / total * 100) if total else 0
    print(f"  Topology coverage: {routed:,}/{total:,} edges ({pct:.1f}%)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Set up pgRouting road network in AEGIS database")
    p.add_argument("--bbox",           default=DEFAULT_UK_BBOX,
                   help='Overpass bounding box "south,west,north,east"')
    p.add_argument("--only-topology",  action="store_true",
                   help="Skip OSM download; only rebuild topology from existing data")
    p.add_argument("--skip-topology",  action="store_true",
                   help="Import OSM data but skip pgr_createTopology (faster)")
    p.add_argument("--db-url",         default="",
                   help="Override DATABASE_URL env var")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    global DB_URL
    if args.db_url:
        DB_URL = args.db_url

    print("[1/5] Connecting to database …")
    conn = get_db_conn()

    print("[2/5] Checking pgRouting availability …")
    if not check_pgrouting(conn):
        print("  pgRouting not available in pg_available_extensions.")
        print("  Install with: apt install postgresql-16-pgrouting (Ubuntu)")
        print("  Continuing with table creation only (spatial_analytics will use circle fallback).")
        create_road_network_table(conn)
        conn.close()
        return

    print("[3/5] Installing pgRouting extension …")
    pgrouting_ok = install_pgrouting(conn)
    create_road_network_table(conn)

    if not args.only_topology:
        print("[4/5] Downloading OSM road network …")
        try:
            ways = fetch_osm_roads(args.bbox)
            if ways:
                import_roads(conn, ways)
            else:
                print("  No road data returned from Overpass API.")
        except Exception as exc:
            print(f"  OSM download failed: {exc}")
            print("  You can re-run with --only-topology once data is in the table.")
    else:
        print("[4/5] Skipping OSM download (--only-topology).")

    if pgrouting_ok and not args.skip_topology:
        print("[5/5] Building routing topology …")
        try:
            build_topology(conn)
            verify_topology(conn)
        except Exception as exc:
            print(f"  Topology build failed: {exc}")
            print("  pgr_createTopology requires pgRouting >= 2.0 installed on the server.")
    else:
        print("[5/5] Skipping topology build.")

    conn.close()
    print("\npgRouting setup complete.")
    print("AEGIS spatial_analytics.py will now use pgRouting for isochrones when available.")
    print("\nTo refresh weekly (add to crontab):")
    print("  0 3 * * 0  python scripts/setup/setup_pgrouting.py --only-topology")


if __name__ == "__main__":
    main()
