"""
Module: check_data_quality.py

Check_data_quality utility script.

Simple explanation:
Standalone script for check_data_quality.
"""

import os
import asyncio, asyncpg, numpy as np
from collections import Counter

async def main():
    c = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis'))
    
    # Check weather data quality
    wo = await c.fetch("""
        SELECT location_name, COUNT(*) as cnt, 
               MIN(recorded_at) as min_t, MAX(recorded_at) as max_t,
               AVG(temperature) as avg_temp, STDDEV(temperature) as std_temp,
               AVG(rainfall_mm) as avg_rain, STDDEV(rainfall_mm) as std_rain,
               AVG(humidity) as avg_hum, STDDEV(humidity) as std_hum
        FROM weather_observations 
        GROUP BY location_name ORDER BY cnt DESC
    """)
    print("=== WEATHER OBSERVATIONS ===")
    for r in wo:
        print(f"  {r['location_name']:20s} rows={r['cnt']:5d}  temp={r['avg_temp']:.1f}Ã‚Â±{r['std_temp']:.1f}  rain={r['avg_rain']:.1f}Ã‚Â±{r['std_rain']:.1f}  hum={r['avg_hum']:.1f}Ã‚Â±{r['std_hum']:.1f}")
    
    # Check reports category distribution 
    rp = await c.fetch("SELECT incident_category, severity, COUNT(*) FROM reports GROUP BY incident_category, severity ORDER BY incident_category, severity")
    print("\n=== REPORTS BY CATEGORY x SEVERITY ===")
    for r in rp:
        print(f"  {r['incident_category']:20s} {str(r['severity']):10s} {r['count']}")
    
    # Check flood archives
    fa = await c.fetch("SELECT severity_level, COUNT(*), AVG(damage_gbp) as avg_damage FROM flood_archives GROUP BY severity_level")
    print("\n=== FLOOD ARCHIVES ===")
    for r in fa:
        print(f"  {r['severity_level']:10s} count={r['count']}  avg_damage=Ã‚Â£{r['avg_damage']:,.0f}")
    
    # Check weather columns
    cols = await c.fetch("SELECT column_name FROM information_schema.columns WHERE table_name='weather_observations' ORDER BY ordinal_position")
    print("\n=== WEATHER COLUMNS ===")
    for r in cols:
        print(f"  {r['column_name']}")
    
    # Sample some weather data to see variance
    samples = await c.fetch("SELECT temperature, rainfall_mm, humidity, wind_speed_kmh, pressure_hpa FROM weather_observations ORDER BY RANDOM() LIMIT 20")
    temps = [float(s['temperature']) for s in samples]
    rains = [float(s['rainfall_mm']) for s in samples]
    print(f"\n=== SAMPLE WEATHER VARIANCE ===")
    print(f"  Temps: min={min(temps):.1f} max={max(temps):.1f} range={max(temps)-min(temps):.1f}")
    print(f"  Rains: min={min(rains):.1f} max={max(rains):.1f}")

    await c.close()

asyncio.run(main())
