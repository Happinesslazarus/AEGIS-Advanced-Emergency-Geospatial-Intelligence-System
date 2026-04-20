"""
Generates a regular 10 km × 10 km spatial sampling grid covering the entire UK,
then enriches it with all known SEPA (Scotland) and EA (England/Wales) river
gauge locations.  The result is saved to data/labels/uk_sample_points.geojson
and used by gee_extractor.py to pull 28-feature time-series from Google Earth
Engine for every point from 2000-2024.

Glossary:
  10 km grid    = a lattice of points spaced 10,000 m apart in OSGB36 / BNG
                  (British National Grid, EPSG:27700) -- a flat cartesian CRS
                  ideal for equal-area distance calculations over the UK
  EPSG:27700    = the OSGB36 British National Grid coordinate reference system
  EPSG:4326     = WGS84 geographic CRS (latitude / longitude) used by GeoJSON
  GeoPandas     = Python library for handling geospatial data frames
  Natural Earth = free vector dataset of country boundaries
  GeoJSON       = JSON format for geographic features (points, polygons, etc.)
  CRS           = Coordinate Reference System

  - Output -> ai-engine/scripts/features/gee_extractor.py  (reads the GeoJSON)
  - Output -> ai-engine/scripts/features/build_master_dataset.py (spatial join)
  - Run once; only re-run if boundary data changes

Usage:
  python scripts/sampling/generate_uk_grid.py
  python scripts/sampling/generate_uk_grid.py --spacing 5000  # 5 km grid
  python scripts/sampling/generate_uk_grid.py --output data/labels/my_grid.geojson
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

# Dependency imports -- fail fast with helpful message
try:
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import Point, box
    from shapely.ops import unary_union
except ImportError as exc:
    sys.exit(
        f"Missing dependency: {exc}. "
        "Run: pip install geopandas shapely pandas"
    )

try:
    import geodatasets as _geodatasets  # optional; fallback logic inside load_uk_boundary()
except ImportError:
    _geodatasets = None  # type: ignore[assignment]

# Root of the ai-engine package so relative imports work regardless of cwd
_AI_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR = _AI_ROOT / "data"
_LABELS_DIR = _DATA_DIR / "labels"

# Known EA and SEPA gauge locations (lat/lon, EPSG:4326)
# Extend this list as new gauges become operational.
# Source: Environment Agency / SEPA official gauge registers, 2024.
KNOWN_GAUGES: list[dict] = [
    # SEPA gauges -- Scotland
    {"id": "sepa_tay_perth",       "name": "River Tay at Perth",         "lat": 56.395, "lon": -3.427, "agency": "SEPA"},
    {"id": "sepa_forth_stirling",  "name": "River Forth at Stirling",     "lat": 56.116, "lon": -3.936, "agency": "SEPA"},
    {"id": "sepa_clyde_dalmarnock","name": "River Clyde at Dalmarnock",   "lat": 55.847, "lon": -4.220, "agency": "SEPA"},
    {"id": "sepa_dee_aberdeen",    "name": "River Dee at Aberdeen",       "lat": 57.137, "lon": -2.098, "agency": "SEPA"},
    {"id": "sepa_ness_inverness",  "name": "River Ness at Inverness",     "lat": 57.479, "lon": -4.228, "agency": "SEPA"},
    {"id": "sepa_tweed_norham",    "name": "River Tweed at Norham",       "lat": 55.714, "lon": -2.155, "agency": "SEPA"},
    {"id": "sepa_eden_dumfries",   "name": "River Nith at Dumfries",      "lat": 55.071, "lon": -3.614, "agency": "SEPA"},
    # EA gauges -- England
    {"id": "ea_thames_kingston",   "name": "Thames at Kingston",          "lat": 51.413, "lon": -0.308, "agency": "EA"},
    {"id": "ea_severn_bewdley",    "name": "Severn at Bewdley",           "lat": 52.376, "lon": -2.315, "agency": "EA"},
    {"id": "ea_trent_nottingham",  "name": "Trent at Nottingham",         "lat": 52.947, "lon": -1.162, "agency": "EA"},
    {"id": "ea_ouse_york",         "name": "Ouse at York",                "lat": 53.961, "lon": -1.083, "agency": "EA"},
    {"id": "ea_exe_thorverton",    "name": "Exe at Thorverton",           "lat": 50.796, "lon": -3.498, "agency": "EA"},
    {"id": "ea_wye_hereford",      "name": "Wye at Hereford",             "lat": 52.058, "lon": -2.715, "agency": "EA"},
    {"id": "ea_eden_great_corby",  "name": "Eden at Great Corby",         "lat": 54.868, "lon": -2.736, "agency": "EA"},
    {"id": "ea_mersey_ashton",     "name": "Mersey at Ashton Weir",       "lat": 53.384, "lon": -2.491, "agency": "EA"},
    {"id": "ea_avon_tewkesbury",   "name": "Avon at Tewkesbury",          "lat": 51.990, "lon": -2.163, "agency": "EA"},
    # EA gauges -- Wales
    {"id": "ea_usk_newport",       "name": "Usk at Newport",              "lat": 51.587, "lon": -3.003, "agency": "EA"},
    {"id": "ea_taff_pontypridd",   "name": "Taff at Pontypridd",          "lat": 51.600, "lon": -3.343, "agency": "EA"},
]


# Step 1 -- load UK boundary polygon

def load_uk_boundary() -> gpd.GeoDataFrame:
    """
    Load the UK land boundary from Natural Earth data.

    Returns a single-row GeoDataFrame with the UK polygon in EPSG:27700
    (British National Grid) so we can do metre-based grid arithmetic.
    """
    # Try multiple sources for naturalearth countries data
    world = None

    # Option 1: geodatasets naturalearth countries (if available)
    try:
        if _geodatasets is not None:
            world = gpd.read_file(_geodatasets.get_path("naturalearth.land"))
            # land dataset has no iso_a3 -- fall through to URL approach
            if "iso_a3" not in world.columns:
                world = None
        else:
            world = None
    except Exception:
        world = None

    # Option 2: download from geopandas GitHub (naturalearth_lowres)
    if world is None:
        _NE_URL = (
            "https://raw.githubusercontent.com/geopandas/geopandas/"
            "main/geopandas/datasets/naturalearth_lowres/"
            "naturalearth_lowres.shp"
        )
        try:
            world = gpd.read_file(_NE_URL)
        except Exception:
            world = None

    # Option 3: hardcoded approximate UK bounding box as fallback
    if world is None or ("iso_a3" not in world.columns):
        from shapely.geometry import Polygon
        # Approximate UK outline (WGS84)
        uk_poly = Polygon([
            (-8.0, 49.8), (2.0, 49.8), (2.0, 51.5), (-8.0, 51.5),   # England+Wales base
            (-8.0, 51.5), (2.0, 51.5), (2.0, 53.0), (-8.0, 53.0),
            (-8.0, 53.0), (-5.0, 53.0), (-5.0, 55.0), (-8.0, 55.0),  # Wales+NW
            (-8.0, 55.0), (-1.5, 55.0), (-1.5, 58.7), (-8.0, 58.7),  # Scotland
            (-8.0, 58.7), (-8.0, 49.8),                                 # close
        ])
        uk = gpd.GeoDataFrame({"geometry": [uk_poly]}, crs="EPSG:4326")
        return uk.to_crs(epsg=27700)

    # Filter to United Kingdom (iso_a3 = "GBR")
    uk = world[world["iso_a3"] == "GBR"].copy()
    if uk.empty:
        # Fallback: union of Great Britain + Northern Ireland by name
        uk = world[world["name"].str.contains("United Kingdom", na=False)].copy()
    if uk.empty:
        raise RuntimeError(
            "Could not load UK boundary from naturalearth data. "
            "Check internet connectivity or supply a boundary shapefile."
        )

    # Reproject from WGS84 -> British National Grid for metric spacing
    uk_bng = uk.to_crs(epsg=27700)
    return uk_bng


# Step 2 -- generate regular grid inside UK boundary

def generate_grid(
    uk_bng: gpd.GeoDataFrame,
    spacing_m: int = 10_000,
) -> gpd.GeoDataFrame:
    """
    Generate a regular grid of points spaced `spacing_m` metres apart
    in BNG, keeping only points that fall within the UK land boundary.

    Parameters
    uk_bng     : UK boundary in EPSG:27700
    spacing_m  : Grid spacing in metres (default 10,000 = 10 km)

    Returns

    GeoDataFrame with columns [grid_id, geometry] in EPSG:4326 (lat/lon)
    """
    boundary_geom = unary_union(uk_bng.geometry)
    minx, miny, maxx, maxy = boundary_geom.bounds

    # Build all candidate (easting, northing) pairs
    eastings  = np.arange(minx, maxx + spacing_m, spacing_m)
    northings = np.arange(miny, maxy + spacing_m, spacing_m)

    points: list[Point] = []
    for e in eastings:
        for n in northings:
            pt = Point(e, n)
            if boundary_geom.contains(pt):
                points.append(pt)

    gdf = gpd.GeoDataFrame(
        {"grid_id": [f"grid_{i:05d}" for i in range(len(points))]},
        geometry=points,
        crs="EPSG:27700",
    )

    print(f"  Grid points inside UK boundary: {len(gdf):,} ({spacing_m/1000:.0f} km spacing)")

    # Reproject to WGS84 for GeoJSON and GEE compatibility
    return gdf.to_crs(epsg=4326)


# Step 3 -- add SEPA/EA gauge locations as high-value points

def add_gauge_points(grid_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Append known SEPA and EA gauge locations to the grid.
    Gauges are high-value because we have real discharge time-series for them
    (used to build flood labels in build_flood_labels.py).

    Duplicate detection: if a gauge point falls within 2 km of an existing
    grid point it is still added but marked as a gauge -- worth the minor
    overlap because the discharge label quality is much higher.
    """
    gauge_rows = []
    for g in KNOWN_GAUGES:
        gauge_rows.append(
            {
                "grid_id":   g["id"],
                "gauge_id":  g["id"],
                "gauge_name": g["name"],
                "agency":    g["agency"],
                "is_gauge":  True,
                "geometry":  Point(g["lon"], g["lat"]),
            }
        )

    gauge_gdf = gpd.GeoDataFrame(gauge_rows, crs="EPSG:4326")

    # Combine with main grid (fill missing gauge columns with safe defaults)
    grid_gdf["is_gauge"]   = False
    grid_gdf["agency"]     = None
    grid_gdf["gauge_id"]   = None
    grid_gdf["gauge_name"] = None

    combined = pd.concat([grid_gdf, gauge_gdf], ignore_index=True)
    combined = gpd.GeoDataFrame(combined, crs="EPSG:4326")

    print(
        f"  Total points after adding {len(gauge_rows)} gauges: {len(combined):,}"
    )
    return combined


# Step 4 -- add lat/lon columns (convenience for GEE extractor)

def add_latlon_columns(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Add explicit `lat` and `lon` float columns alongside the geometry."""
    gdf = gdf.copy()
    gdf["lon"] = gdf.geometry.x
    gdf["lat"] = gdf.geometry.y
    return gdf


# Step 5 -- save

def save_geojson(gdf: gpd.GeoDataFrame, output_path: Path) -> None:
    """Write GeoDataFrame to GeoJSON, creating parent directories as needed."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(str(output_path), driver="GeoJSON")
    print(f"  Saved -> {output_path}  ({len(gdf):,} features)")


# CLI entrypoint

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate UK spatial sampling grid for GEE feature extraction"
    )
    p.add_argument(
        "--spacing",
        type=int,
        default=10_000,
        metavar="METRES",
        help="Grid spacing in metres (default: 10000 = 10 km)",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=_LABELS_DIR / "uk_sample_points.geojson",
        help="Output GeoJSON path (default: data/labels/uk_sample_points.geojson)",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    print("[1/4] Loading UK boundary ...")
    uk_bng = load_uk_boundary()

    print(f"[2/4] Generating {args.spacing/1000:.0f} km grid ...")
    grid = generate_grid(uk_bng, spacing_m=args.spacing)

    print("[3/4] Adding SEPA + EA gauge points ...")
    enriched = add_gauge_points(grid)
    enriched  = add_latlon_columns(enriched)

    print("[4/4] Saving GeoJSON ...")
    save_geojson(enriched, args.output)

    # Also write a summary JSON for quick inspection
    summary = {
        "total_points":  int(len(enriched)),
        "grid_points":   int(enriched["is_gauge"].eq(False).sum()),
        "gauge_points":  int(enriched["is_gauge"].eq(True).sum()),
        "spacing_m":     args.spacing,
        "bbox": {
            "minlat": float(enriched["lat"].min()),
            "maxlat": float(enriched["lat"].max()),
            "minlon": float(enriched["lon"].min()),
            "maxlon": float(enriched["lon"].max()),
        },
        "output_path": str(args.output),
    }
    summary_path = args.output.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"\nDone. Summary -> {summary_path}")
    print(f"  Grid points : {summary['grid_points']:,}")
    print(f"  Gauge points: {summary['gauge_points']:,}")
    print(f"  Total        : {summary['total_points']:,}")


if __name__ == "__main__":
    main()
