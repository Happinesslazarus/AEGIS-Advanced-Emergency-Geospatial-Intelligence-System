"""
Data ingestion utilities: reads raw weather CSVs or API responses,
validates schemas, handles missing values, merges hazard event labels,
and produces a clean pandas DataFrame ready for feature engineering.

- Called by base_real_pipeline.py and training_pipeline.py
- Input: raw files from data_fetch_open_meteo.py output directory
- Output: labelled DataFrame fed into feature_engineering.py
- Labelling rules defined in data_labeling_pipeline.py
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta, timezone
from loguru import logger
import asyncpg
import aiohttp
import json
from pathlib import Path
import yaml

class RealDatasetIngestion:
    """
    Ingest real disaster and environmental data from external APIs and datasets.
    This class ensures all training happens on validated, real-world data.
    """
    
    MINIMUM_REQUIRED_ROWS = 1000
    
    # UK Environment Agency Flood Monitoring API
    EA_FLOOD_API = "https://environment.data.gov.uk/flood-monitoring"
    
    # SEPA API endpoints
    SEPA_API = "https://www2.sepa.org.uk/waterlevels/api"
    
    # Met Office DataPoint (requires API key)
    METOFFICE_API = "https://api-metoffice.apiconnect.ibmcloud.com/metoffice/production/v0"
    
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize data ingestion pipeline."""
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        self.db_pool: Optional[asyncpg.Pool] = None
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def initialize(self, database_url: str):
        """Initialize database and HTTP session."""
        try:
            self.db_pool = await asyncpg.create_pool(
                dsn=database_url,
                min_size=2,
                max_size=10,
                command_timeout=60
            )
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=300))
            logger.success("RealDatasetIngestion initialized")
        except Exception as e:
            logger.error(f"Failed to initialize RealDatasetIngestion: {e}")
            raise
    
    async def cleanup(self):
        """Close connections."""
        if self.db_pool:
            await self.db_pool.close()
        if self.session:
            await self.session.close()
    
    async def check_table_row_counts(self) -> Dict[str, int]:
        """
        Check row counts for all tables required for training.
        
        Returns:
            Dictionary mapping table name to row count
        """
        tables = {
            'reports': 'SELECT COUNT(*) FROM reports WHERE deleted_at IS NULL',
            'alerts': 'SELECT COUNT(*) FROM alerts WHERE deleted_at IS NULL',
            'flood_zones': 'SELECT COUNT(*) FROM flood_zones',
            'community_help': 'SELECT COUNT(*) FROM community_help WHERE deleted_at IS NULL'
        }
        
        counts = {}
        async with self.db_pool.acquire() as conn:
            for table_name, query in tables.items():
                try:
                    count = await conn.fetchval(query)
                    counts[table_name] = count
                    logger.info(f"Table '{table_name}': {count} rows")
                except Exception as e:
                    logger.warning(f"Table '{table_name}' not accessible: {e}")
                    counts[table_name] = 0
        
        return counts
    
    async def ingest_uk_flood_monitoring_data(
        self,
        start_date: datetime,
        end_date: datetime,
        limit: int = 5000
    ) -> int:
        """
        Ingest real flood monitoring station data from UK Environment Agency.
        
        Args:
            start_date: Start date for data collection
            end_date: End date for data collection
            limit: Maximum records to fetch
        
        Returns:
            Number of records ingested
        """
        logger.info(f"Ingesting UK Environment Agency flood data from {start_date} to {end_date}")
        
        try:
            # Fetch flood monitoring stations
            stations_url = f"{self.EA_FLOOD_API}/id/stations?_limit={limit}"
            async with self.session.get(stations_url) as response:
                if response.status != 200:
                    logger.error(f"Failed to fetch flood stations: HTTP {response.status}")
                    return 0
                
                data = await response.json()
                stations = data.get('items', [])
                
                if not stations:
                    logger.warning("No flood monitoring stations returned from API")
                    return 0
                
                logger.info(f"Found {len(stations)} flood monitoring stations")
            
            # For each station, fetch readings and create synthetic reports based on high water levels
            ingested_count = 0
            import hashlib
            
            async with self.db_pool.acquire() as conn:
                for station in stations[:150]:  # Limit to first 150 stations for practicality
                    try:
                        station_id = station.get('stationReference', station.get('@id', '').split('/')[-1])
                        label = station.get('label', 'Unknown Station')
                        lat = station.get('lat')
                        lon = station.get('long')
                        
                        if not lat or not lon:
                            continue
                        
                        # Fetch latest readings for this station
                        readings_url = f"{self.EA_FLOOD_API}/id/stations/{station_id}/readings?_sorted&_limit=100"
                        
                        async with self.session.get(readings_url) as reading_response:
                            if reading_response.status != 200:
                                continue
                            
                            reading_data = await reading_response.json()
                            readings = reading_data.get('items', [])
                            
                            # Track readings for sampling strategy
                            high_readings = []  # > 1.5m (flood events)
                            normal_readings = []  # 0.5-1.5m (non-flood background)
                            
                            for reading in readings:
                                timestamp_str = reading.get('dateTime')
                                value = reading.get('value')
                                
                                if not timestamp_str or value is None:
                                    continue
                                
                                timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                                
                                if not (start_date <= timestamp <= end_date):
                                    continue
                                
                                # Categorize readings by water level for balanced sampling
                                if value > 1.5:
                                    high_readings.append((timestamp, value))
                                elif value >= 0.5:
                                    normal_readings.append((timestamp, value))
                                # Skip very low readings (< 0.5m) as noise
                            
                            # BALANCED INGESTION: sample both classes proportionally
                            # Goal: ~60% flood events, 40% normal (realistic class imbalance)
                            # But preserve actual distribution rather than forcing ratio
                            
                            # Ingest high-water readings as positive flood class
                            # Sample every N-th reading to avoid excessive volume
                            sample_interval_high = max(1, len(high_readings) // 500) if high_readings else 1
                            for timestamp, value in high_readings[::sample_interval_high]:
                                station_hash = hashlib.md5(station_id.encode()).hexdigest()[:4]
                                report_num = f"EA{timestamp.strftime('%y%m%d%H%M')}{station_hash}"
                                
                                try:
                                    await conn.execute("""
                                        INSERT INTO reports (
                                            report_number,
                                            created_at,
                                            coordinates,
                                            location_text,
                                            incident_category,
                                            incident_subtype,
                                            display_type,
                                            severity,
                                            status,
                                            description,
                                            ai_analysis,
                                            ai_confidence,
                                            has_media
                                        ) VALUES (
                                            $1,
                                            $2,
                                            ST_SetSRID(ST_MakePoint($3, $4), 4326),
                                            $5,
                                            $6,
                                            $7,
                                            $8,
                                            $9,
                                            $10,
                                            $11,
                                            $12,
                                            $13,
                                            $14
                                        )
                                        ON CONFLICT (report_number) DO NOTHING
                                    """, 
                                        report_num,
                                        timestamp,
                                        lon,
                                        lat,
                                        f"{label} (Lat: {lat:.4f}, Lon: {lon:.4f})",
                                        'flood',
                                        'river_flooding',
                                        'River Flooding - High Water Level',
                                        'high' if value > 2.5 else 'medium',
                                        'verified',
                                        f"Flood event: {label} water level {value}m at {timestamp.strftime('%Y-%m-%d %H:%M UTC')}",
                                        json.dumps({
                                            'source': 'UK_EA_Flood_Monitoring',
                                            'station_id': station_id,
                                            'station_label': label,
                                            'water_level_m': float(value),
                                            'flood_class': 1,
                                            'ingestion_method': 'automated_api',
                                            'ingestion_timestamp': datetime.now(timezone.utc).isoformat()
                                        }),
                                        85,
                                        False
                                    )
                                    ingested_count += 1
                                except Exception as e:
                                    logger.debug(f"Failed to insert high-water reading: {e}")
                            
                            # Ingest normal-water readings as negative (non-flood) class
                            # Sample less frequently to balance with flood events
                            sample_interval_normal = max(1, len(normal_readings) // 500) if normal_readings else 1
                            for timestamp, value in normal_readings[::sample_interval_normal]:
                                station_hash = hashlib.md5(station_id.encode()).hexdigest()[:4]
                                report_num = f"EA{timestamp.strftime('%y%m%d%H%M')}{station_hash}"
                                
                                try:
                                    await conn.execute("""
                                        INSERT INTO reports (
                                            report_number,
                                            created_at,
                                            coordinates,
                                            location_text,
                                            incident_category,
                                            incident_subtype,
                                            display_type,
                                            severity,
                                            status,
                                            description,
                                            ai_analysis,
                                            ai_confidence,
                                            has_media
                                        ) VALUES (
                                            $1,
                                            $2,
                                            ST_SetSRID(ST_MakePoint($3, $4), 4326),
                                            $5,
                                            $6,
                                            $7,
                                            $8,
                                            $9,
                                            $10,
                                            $11,
                                            $12,
                                            $13,
                                            $14
                                        )
                                        ON CONFLICT (report_number) DO NOTHING
                                    """,
                                        report_num,
                                        timestamp,
                                        lon,
                                        lat,
                                        f"{label} (Lat: {lat:.4f}, Lon: {lon:.4f})",
                                        'flood',
                                        'normal_conditions',
                                        'Normal River Conditions',
                                        'low',
                                        'verified',
                                        f"Normal conditions: {label} water level {value}m at {timestamp.strftime('%Y-%m-%d %H:%M UTC')}",
                                        json.dumps({
                                            'source': 'UK_EA_Flood_Monitoring',
                                            'station_id': station_id,
                                            'station_label': label,
                                            'water_level_m': float(value),
                                            'flood_class': 0,
                                            'ingestion_method': 'automated_api',
                                            'ingestion_timestamp': datetime.now(timezone.utc).isoformat()
                                        }),
                                        65,
                                        False
                                    )
                                    ingested_count += 1
                                except Exception as e:
                                    logger.debug(f"Failed to insert normal-water reading: {e}")
                    
                    except Exception as e:
                        logger.warning(f"Failed to process station {station.get('label', 'unknown')}: {e}")
                        continue
            
            logger.success(f"Ingested {ingested_count} flood monitoring records into reports table")
            return ingested_count
        
        except Exception as e:
            logger.error(f"Failed to ingest UK flood monitoring data: {e}")
            return 0
    
    async def ingest_historical_uk_weather_data(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> int:
        """
        Ingest historical UK weather data to enrich training dataset.
        Uses synthetic realistic data if Met Office API key not available.
        
        Args:
            start_date: Start date
            end_date: End date
        
        Returns:
            Number of weather records ingested
        """
        logger.info(f"Ingesting UK historical weather data from {start_date} to {end_date}")
        
        # UK major cities for weather sampling
        uk_locations = [
            {'name': 'Aberdeen', 'lat': 57.1497, 'lon': -2.0943},
            {'name': 'Glasgow', 'lat': 55.8642, 'lon': -4.2518},
            {'name': 'Edinburgh', 'lat': 55.9533, 'lon': -3.1883},
            {'name': 'Dundee', 'lat': 56.4620, 'lon': -2.9707},
            {'name': 'Inverness', 'lat': 57.4778, 'lon': -4.2247},
        ]
        
        ingested_count = 0
        
        # Use Open-Meteo Historical Weather API (FREE, no key required)
        # This replaces all synthetic np.random data
        
        async with self.db_pool.acquire() as conn:
            # Create weather_observations table if not exists
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS weather_observations (
                    id SERIAL PRIMARY KEY,
                    timestamp TIMESTAMPTZ NOT NULL,
                    location_name VARCHAR(100),
                    latitude FLOAT NOT NULL,
                    longitude FLOAT NOT NULL,
                    temperature_c FLOAT,
                    rainfall_mm FLOAT,
                    humidity_percent FLOAT,
                    wind_speed_ms FLOAT,
                    pressure_hpa FLOAT,
                    source VARCHAR(100),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(timestamp, latitude, longitude)
                )
            """)
            
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            
            for location in uk_locations:
                try:
                    # Open-Meteo historical hourly API — real weather data, no key needed
                    url = (
                        f"https://archive-api.open-meteo.com/v1/archive"
                        f"?latitude={location['lat']}&longitude={location['lon']}"
                        f"&start_date={start_str}&end_date={end_str}"
                        f"&hourly=temperature_2m,rain,relative_humidity_2m,"
                        f"windspeed_10m,surface_pressure"
                        f"&timezone=auto"
                    )
                    
                    async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                        if resp.status != 200:
                            logger.warning(f"Open-Meteo API returned {resp.status} for {location['name']}")
                            continue
                        
                        data = await resp.json()
                        hourly = data.get('hourly', {})
                        times = hourly.get('time', [])
                        
                        logger.info(f"Fetched {len(times)} hourly observations for {location['name']} from Open-Meteo")
                        
                        for i, time_str in enumerate(times):
                            ts = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
                            temperature = hourly.get('temperature_2m', [None])[i]
                            rainfall = hourly.get('rain', [None])[i]
                            humidity = hourly.get('relative_humidity_2m', [None])[i]
                            wind_speed = hourly.get('windspeed_10m', [None])[i]
                            pressure = hourly.get('surface_pressure', [None])[i]
                            
                            if temperature is None:
                                continue
                            
                            try:
                                await conn.execute("""
                                    INSERT INTO weather_observations (
                                        timestamp, location_name, latitude, longitude,
                                        temperature_c, rainfall_mm, humidity_percent,
                                        wind_speed_ms, pressure_hpa, source
                                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                                    ON CONFLICT (timestamp, latitude, longitude) DO NOTHING
                                """,
                                    ts, location['name'], location['lat'], location['lon'],
                                    float(temperature) if temperature is not None else None,
                                    float(rainfall) if rainfall is not None else 0.0,
                                    float(humidity) if humidity is not None else None,
                                    float(wind_speed) / 3.6 if wind_speed is not None else None,  # km/h -> m/s
                                    float(pressure) if pressure is not None else None,
                                    'open_meteo_archive'
                                )
                                ingested_count += 1
                            except Exception as e:
                                pass  # Skip duplicates silently
                
                except Exception as e:
                    logger.warning(f"Failed to fetch Open-Meteo data for {location['name']}: {e}")
        
        logger.success(f"Ingested {ingested_count} weather observations into weather_observations table")
        return ingested_count
    
    async def ingest_complete_training_dataset(
        self,
        lookback_days: int = 180
    ) -> Dict[str, int]:
        """
        Complete dataset ingestion pipeline.
        Pulls data from all external sources and validates minimum requirements.
        
        Args:
            lookback_days: Number of days of historical data to ingest
        
        Returns:
            Dictionary with ingestion statistics
        
        Raises:
            ValueError: If minimum row requirements not met
        """
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=lookback_days)
        
        logger.info("=" * 80)
        logger.info("REAL DATASET INGESTION PIPELINE STARTED")
        logger.info(f"Date Range: {start_date} to {end_date}")
        logger.info("=" * 80)
        
        # Step 1: Check current table states
        logger.info("\n[Step 1/4] Checking current database state...")
        initial_counts = await self.check_table_row_counts()
        
        # Step 2: Ingest UK flood monitoring data
        logger.info("\n[Step 2/4] Ingesting UK Environment Agency flood data...")
        flood_ingested = await self.ingest_uk_flood_monitoring_data(start_date, end_date)
        
        # Step 3: Ingest weather data
        logger.info("\n[Step 3/4] Ingesting historical weather data...")
        weather_ingested = await self.ingest_historical_uk_weather_data(start_date, end_date)
        
        # Step 4: Validate final counts
        logger.info("\n[Step 4/4] Validating final dataset...")
        final_counts = await self.check_table_row_counts()
        
        # Calculate total usable training rows
        total_reports = final_counts.get('reports', 0)
        total_weather = await self._count_weather_observations()
        
        logger.info("\n" + "=" * 80)
        logger.info("INGESTION COMPLETE - FINAL STATISTICS")
        logger.info("=" * 80)
        logger.info(f"Reports table: {final_counts.get('reports', 0)} rows (added: {flood_ingested})")
        logger.info(f"Weather observations: {total_weather} rows (added: {weather_ingested})")
        logger.info(f"Alerts table: {final_counts.get('alerts', 0)} rows")
        logger.info(f"Flood zones: {final_counts.get('flood_zones', 0)} rows")
        logger.info(f"Community help: {final_counts.get('community_help', 0)} rows")
        logger.info("=" * 80)
        
        # Validate minimum requirements
        if total_reports < self.MINIMUM_REQUIRED_ROWS:
            error_msg = (
                f"VALIDATION FAILED: Minimum {self.MINIMUM_REQUIRED_ROWS} training rows required, "
                f"but only {total_reports} available in reports table. "
                f"Training ABORTED to prevent model training on insufficient data."
            )
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        logger.success(f"✓ Validation passed: {total_reports} rows available (>= {self.MINIMUM_REQUIRED_ROWS} required)")
        
        stats = {
            'total_reports': total_reports,
            'total_weather_obs': total_weather,
            'flood_ingested': flood_ingested,
            'weather_ingested': weather_ingested,
            'initial_reports': initial_counts.get('reports', 0),
            'final_reports': final_counts.get('reports', 0),
            'validation_passed': True
        }
        
        return stats
    
    async def _count_weather_observations(self) -> int:
        """Count weather observations in database."""
        try:
            async with self.db_pool.acquire() as conn:
                count = await conn.fetchval("""
                    SELECT COUNT(*) FROM weather_observations
                    WHERE timestamp IS NOT NULL
                """)
                return count or 0
        except Exception:
            return 0

async def main():
    """CLI entry point for dataset ingestion."""
    from app.core.config import settings
    
    ingestion = RealDatasetIngestion()
    await ingestion.initialize(settings.DATABASE_URL)
    
    try:
        stats = await ingestion.ingest_complete_training_dataset(lookback_days=180)
        
        print("\n" + "=" * 80)
        print("DATASET INGESTION SUCCESSFUL")
        print("=" * 80)
        print(f"Total reports: {stats['total_reports']}")
        print(f"Total weather observations: {stats['total_weather_obs']}")
        print(f"Validation: {'PASSED ✓' if stats['validation_passed'] else 'FAILED ✗'}")
        print("=" * 80)
    
    finally:
        await ingestion.cleanup()

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
