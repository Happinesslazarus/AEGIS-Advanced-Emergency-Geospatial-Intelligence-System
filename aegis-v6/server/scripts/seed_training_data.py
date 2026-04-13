#!/usr/bin/env python3
"""
Module: seed_training_data.py

Seed_training_data utility script.

Simple explanation:
Standalone script for seed_training_data.
"""

import json
import os
import random
import sys
import uuid
import hashlib
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import psycopg2
import psycopg2.extras
import requests

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

# UK Locations with realistic coordinates
UK_LOCATIONS = [
    {"name": "London - Thames Barrier", "lat": 51.5074, "lon": -0.1278, "region": "london"},
    {"name": "London - Bermondsey", "lat": 51.4980, "lon": -0.0637, "region": "london"},
    {"name": "London - Greenwich", "lat": 51.4769, "lon": 0.0005, "region": "london"},
    {"name": "Manchester - City Centre", "lat": 53.4808, "lon": -2.2426, "region": "north-west"},
    {"name": "Manchester - Salford", "lat": 53.4830, "lon": -2.2931, "region": "north-west"},
    {"name": "Leeds - City Centre", "lat": 53.8008, "lon": -1.5491, "region": "yorkshire"},
    {"name": "Leeds - Kirkstall", "lat": 53.8130, "lon": -1.6022, "region": "yorkshire"},
    {"name": "Sheffield - Don Valley", "lat": 53.3811, "lon": -1.4701, "region": "yorkshire"},
    {"name": "York - Ouse Riverside", "lat": 53.9600, "lon": -1.0873, "region": "yorkshire"},
    {"name": "Birmingham - City Centre", "lat": 52.4862, "lon": -1.8904, "region": "west-midlands"},
    {"name": "Bristol - Avon Gorge", "lat": 51.4545, "lon": -2.5879, "region": "south-west"},
    {"name": "Carlisle - Eden Valley", "lat": 54.8925, "lon": -2.9329, "region": "north-west"},
    {"name": "Newcastle - Tyneside", "lat": 54.9783, "lon": -1.6178, "region": "north-east"},
    {"name": "Edinburgh - Old Town", "lat": 55.9533, "lon": -3.1883, "region": "scotland"},
    {"name": "Glasgow - Clydeside", "lat": 55.8642, "lon": -4.2518, "region": "scotland"},
    {"name": "Aberdeen - Dee Valley", "lat": 57.1497, "lon": -2.0943, "region": "scotland"},
    {"name": "Cardiff - Bay Area", "lat": 51.4816, "lon": -3.1791, "region": "wales"},
    {"name": "Swansea - Coastal", "lat": 51.6214, "lon": -3.9436, "region": "wales"},
    {"name": "Liverpool - Mersey", "lat": 53.4084, "lon": -2.9916, "region": "north-west"},
    {"name": "Nottingham - Trent Valley", "lat": 52.9548, "lon": -1.1581, "region": "east-midlands"},
    {"name": "Cambridge - Fens", "lat": 52.2053, "lon": 0.1218, "region": "east"},
    {"name": "Oxford - Thames", "lat": 51.7520, "lon": -1.2577, "region": "south-east"},
    {"name": "Exeter - Exe Estuary", "lat": 50.7184, "lon": -3.5339, "region": "south-west"},
    {"name": "Plymouth - Coastal", "lat": 50.3755, "lon": -4.1427, "region": "south-west"},
    {"name": "Norwich - Broads", "lat": 52.6309, "lon": 1.2974, "region": "east"},
    {"name": "Inverness - Highland", "lat": 57.4778, "lon": -4.2247, "region": "scotland"},
    {"name": "Perth - Tay Valley", "lat": 56.3950, "lon": -3.4308, "region": "scotland"},
    {"name": "Dumfries - Nith Valley", "lat": 55.0700, "lon": -3.6052, "region": "scotland"},
    {"name": "Reading - Thames Valley", "lat": 51.4543, "lon": -0.9781, "region": "south-east"},
    {"name": "Southampton - Itchen", "lat": 50.9097, "lon": -1.4044, "region": "south-east"},
    {"name": "Hull - Humber", "lat": 53.7457, "lon": -0.3367, "region": "yorkshire"},
    {"name": "Preston - Ribble", "lat": 53.7632, "lon": -2.7031, "region": "north-west"},
    {"name": "Shrewsbury - Severn", "lat": 52.7077, "lon": -2.7540, "region": "west-midlands"},
    {"name": "Gloucester - Severn Vale", "lat": 51.8642, "lon": -2.2382, "region": "south-west"},
    {"name": "Tewkesbury - Confluence", "lat": 51.9914, "lon": -2.1600, "region": "south-west"},
    {"name": "Cockermouth - Derwent", "lat": 54.6612, "lon": -3.3620, "region": "north-west"},
    {"name": "Kendal - Kent Valley", "lat": 54.3269, "lon": -2.7461, "region": "north-west"},
    {"name": "Morpeth - Wansbeck", "lat": 55.1676, "lon": -1.6868, "region": "north-east"},
    {"name": "Bewdley - Severn", "lat": 52.3756, "lon": -2.3174, "region": "west-midlands"},
    {"name": "Hebden Bridge - Calder", "lat": 53.7420, "lon": -2.0122, "region": "yorkshire"},
]

# Disaster Report Templates (realistic descriptions)
FLOOD_DESCRIPTIONS = [
    "Severe flooding reported on {street}. Water level rising rapidly, approximately {depth}cm deep. Multiple properties affected. Road completely impassable.",
    "Flash flooding after heavy rainfall. Drains overwhelmed on {street}. Water entering ground floor properties. Residents evacuating to first floor.",
    "River has breached its banks near {location}. Flood water spreading across {area} area. Emergency services called. Sandbags being deployed.",
    "Major flooding incident. Water pumping stations overwhelmed. Approximately {count} properties at risk. Temporary flood barriers deployed.",
    "Persistent rainfall causing surface water flooding on {street}. Multiple roads closed. Public transport severely disrupted. Water rescue teams deployed.",
    "Coastal flooding reported due to high tides and strong winds. Sea defences under pressure near {location}. Spray reaching residential areas.",
    "Flooding from blocked drainage system. Water pooling in {area} and spreading rapidly. Sewage contamination suspected. Environmental health notified.",
    "River {river} at record levels near {location}. Flood warnings issued for surrounding area. Evacuation centres being prepared at local community halls.",
    "Groundwater flooding emerging in {area}. Basements and underground car parks inundated. Structural concerns for older buildings in affected zone.",
    "Catastrophic pipe burst causing localised flooding on {street}. Water main fractured. Road surface breaking up. Traffic diverted for approximately 2 miles.",
    "Flooding in underpass near {location}. Vehicle stranded in deep water. Fire brigade extracting occupants. Road closed in both directions.",
    "Farmland extensively flooded near {location}. Livestock at risk. Emergency feeding stations being set up. Agricultural damage estimated to be severe.",
    "Urban flash flood after thunderstorm. Storm drains backing up across {area}. Several basement flats flooded. Residents reporting sewage backflow.",
    "Tidal surge flooding reported at {location}. Coastal path submerged. Beach huts damaged. Lifeboat station on standby.",
    "Flood water receding slowly from {area}. Significant debris and contamination remaining. Clean-up operations expected to take several days.",
]

STORM_DESCRIPTIONS = [
    "Severe storm causing structural damage across {area}. Multiple trees down blocking roads. Power lines damaged. Approximately {count} properties without electricity.",
    "High winds causing significant damage. Roof tiles flying off buildings on {street}. Scaffolding collapsed. Emergency services responding to multiple calls.",
    "Lightning strike caused fire at property on {street}. Electrical systems damaged. Building evacuated as precaution. Fire brigade on scene.",
    "Storm damage assessment ongoing. {count} incidents reported in past 2 hours. Trampoline from garden has struck vehicle on {street}. Multiple road closures.",
    "Tornado-like wind funnel reported near {location}. Significant damage to mobile homes and caravans. Debris scattered across wide area. Air ambulance called.",
    "Hailstorm causing extensive damage to vehicles and greenhouses in {area}. Golf-ball sized hailstones reported. Some injuries from flying glass.",
    "Winter storm bringing heavy snow and ice. Roads dangerous across {area}. Multiple road traffic incidents. Gritting teams unable to keep up with conditions.",
    "Strong winds causing tree to fall onto occupied vehicle on {street}. Casualties reported. Emergency services on scene. Road completely blocked.",
    "Storm surge and high winds breaching coastal defences near {location}. Shingle being thrown onto coastal road. Several vehicles damaged.",
    "Power outage affecting {count} properties due to storm damage to grid infrastructure. Engineers working to restore supply. Estimated restoration: {hours} hours.",
    "Severe thunderstorm activity. Multiple lightning strikes reported across {area}. Communication towers affected. Mobile phone coverage disrupted.",
    "Storm causing industrial unit roof to partially collapse in {area}. Building evacuated. Structural assessment required before re-entry. Adjacent businesses affected.",
]

HEATWAVE_DESCRIPTIONS = [
    "Extreme temperatures recorded at {location}. {temp}Â°C measured at 2pm. Several people treated for heat exhaustion at outdoor events. Water supplies strained.",
    "Wildfire risk elevated due to prolonged heatwave near {location}. Grass fires reported on multiple sites. Fire service issuing warnings about barbecue use.",
    "Heat-related health emergency. {count} people hospitalised with heat stroke in {area} today. NHS declaring major incident at local A&E departments.",
    "Railway services suspended due to rail buckling risk. Track temperature exceeding safety limits. Passengers stranded at {location} station.",
    "Water supply pressure dropping in {area} due to unprecedented demand. Hosepipe ban in effect. Emergency water distribution points being set up.",
    "Road surface melting on {street} causing traffic hazards. Vehicles becoming stuck in softened tarmac. Highway maintenance crews deployed urgently.",
    "Reservoir levels critically low near {location}. Water company implementing emergency measures. Supply interruptions expected in coming days.",
    "Reports of livestock dying from heat stress in fields near {location}. RSPCA called to multiple locations. Farmers struggling with water supply.",
    "School closures across {area} due to extreme heat. Classrooms unsafe at {temp}Â°C. Children sent home. Working parents facing childcare crisis.",
    "Heat exhaustion cases surging at {location}. Ambulance service reporting unprecedented 999 call volumes. Public urged to check on vulnerable neighbours.",
]

WILDFIRE_DESCRIPTIONS = [
    "Wildfire spreading rapidly across moorland near {location}. Approximately {area_ha} hectares burning. Smoke visible from {distance}km away. Evacuation in progress.",
    "Grass fire on {street} area spreading toward residential properties. Fire crews from {count} stations attending. Residents told to close windows and doors.",
    "Forest fire near {location} threatening wildlife reserve. Fire break being cut. Helicopters requested for aerial firefighting support.",
    "Peat fire burning deep underground near {location}. Extremely difficult to extinguish. Environmental damage extensive. Air quality warnings issued.",
    "Heathland fire caused by suspected arson near {location}. Police investigating. Fire service managing blaze with 8 appliances. No injuries reported so far.",
    "Crop fire spreading due to dry conditions and wind near {location}. Multiple farm buildings threatened. Livestock being moved to safety.",
    "Wildfire at {location} nature reserve. Rare habitat being destroyed. Conservation teams assisting fire service. Controlled burn strategy being considered.",
    "Large grass fire adjacent to railway line near {location}. Train services suspended. Significant smoke affecting visibility on nearby roads.",
]

DROUGHT_DESCRIPTIONS = [
    "Severe drought conditions in {area}. River levels at historic lows. Fish rescue operations underway. Environment Agency issuing alerts for water abstraction.",
    "Agricultural drought emergency near {location}. Crop failures widespread. Farmers applying for emergency grants. Irrigation systems unable to cope.",
    "Water company declaring drought in {area} region. Mandatory water use restrictions in effect. Fines for non-compliance being enforced.",
    "Reservoir storage at {percent}% capacity near {location}. Lowest recorded level since monitoring began. Emergency water imports being arranged.",
    "Drought causing ground subsidence in {area}. Properties reporting cracking and structural movement. Insurers receiving surge of claims.",
    "River {river} dried up completely near {location} for first time in recorded history. Major ecological concern. Emergency habitat rescue.",
    "Drought stress causing tree die-off in urban areas across {area}. Falling branches from dead trees creating safety hazards.",
    "Water rationing implemented in {area}. Standpipes installed on affected streets. Bottled water distribution from community centres.",
]

OTHER_DESCRIPTIONS = [
    "Chemical spill reported at industrial site near {location}. Hazmat teams deployed. 200-metre exclusion zone established. Air quality monitoring underway.",
    "Gas leak detected on {street}. Properties within 50 metres being evacuated. Gas engineers and fire service on scene. Road closed.",
    "Collapsed building at {location}. Search and rescue teams deployed. Urban search dogs being used. Number of casualties unknown at this time.",
    "Major road traffic collision on {street}. Multiple vehicles involved. Air ambulance deployed. Road closed in both directions. Expect long delays.",
    "Sinkhole appeared on {street} near {location}. Road partially collapsed. Utilities exposed. Emergency barriers erected. Engineers assessing stability.",
    "Industrial explosion reported near {location}. Blast radius approximately {distance}m. Several injuries reported. Emergency services in attendance.",
    "Landslide blocking road near {location}. Several tonnes of earth and rock across carriageway. Structural survey of hillside needed before clearance.",
    "Major power outage across {area}. {count} properties affected. Hospital on backup generators. Traffic lights out at multiple junctions.",
    "Water contamination alert in {area}. Do not consume tap water advisory issued. Cause under investigation. Bottled water being distributed.",
    "Bridge structural failure near {location}. Weight restriction implemented. Heavy vehicles diverted. Full closure expected for emergency repairs.",
]

STREETS = [
    "High Street", "Station Road", "Church Lane", "Mill Road", "Park Avenue",
    "Bridge Street", "Castle Road", "Riverside Drive", "London Road", "King Street",
    "Queen Street", "Victoria Road", "Albert Street", "Market Place", "The Crescent",
    "Green Lane", "Meadow Way", "Oak Drive", "Elm Avenue", "Willow Close",
    "Brook Street", "Water Lane", "Flood Street", "River Road", "Valley Drive",
    "Harbour Road", "Ferry Lane", "Canal Street", "Wharf Road", "Quay Street",
]

RIVERS = ["Thames", "Severn", "Trent", "Great Ouse", "Wye", "Aire", "Don",
           "Nene", "Derwent", "Avon", "Dee", "Tay", "Clyde", "Tweed", "Eden",
           "Ribble", "Mersey", "Exe", "Tamar", "Usk", "Itchen", "Test"]

AREAS = ["city centre", "industrial estate", "residential area", "town centre",
         "suburb", "village", "coastal area", "river valley", "flood plain",
         "low-lying area", "hillside", "moorland", "farmland", "wetland area"]

def fill_template(template, location):
    """Fill a description template with random plausible values."""
    return template.format(
        street=random.choice(STREETS),
        location=location["name"],
        area=random.choice(AREAS),
        river=random.choice(RIVERS),
        count=random.randint(3, 150),
        depth=random.randint(10, 120),
        temp=random.randint(35, 42),
        percent=random.randint(8, 30),
        area_ha=random.randint(5, 500),
        distance=random.randint(5, 30),
        hours=random.randint(2, 24),
    )

# HuggingFace Dataset Download
HF_API = "https://datasets-server.huggingface.co/rows"

def fetch_huggingface_crisis_data():
    """Fetch real crisis/disaster text from HuggingFace datasets."""
    print("Fetching disaster data from HuggingFace...")
    
    datasets_to_try = [
        # CrisisNLP multi-event disaster tweets
        {"dataset": "csv", "config": "default", "split": "train"},
    ]
    
    # Try loading the disaster_response_messages dataset
    try:
        url = "https://datasets-server.huggingface.co/rows"
        params = {
            "dataset": "disaster_response_messages",
            "config": "default",
            "split": "train",
            "offset": 0,
            "length": 100,
        }
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if "rows" in data and len(data["rows"]) > 0:
                print(f"  Got {len(data['rows'])} rows from disaster_response_messages")
                return [row["row"] for row in data["rows"]]
    except Exception as e:
        print(f"  disaster_response_messages failed: {e}")

    # Try CrisisLex
    try:
        params = {
            "dataset": "crisis_nlp",
            "config": "default",
            "split": "train",
            "offset": 0,
            "length": 100,
        }
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if "rows" in data and len(data["rows"]) > 0:
                print(f"  Got {len(data['rows'])} rows from crisis_nlp")
                return [row["row"] for row in data["rows"]]
    except Exception as e:
        print(f"  crisis_nlp failed: {e}")

    print("  HuggingFace datasets unavailable; using built-in templates (still realistic)")
    return []

# Open-Meteo Historical Weather
def fetch_weather_data(locations, start_date, end_date):
    """Fetch historical weather data from Open-Meteo API for UK locations."""
    print(f"Fetching weather data from Open-Meteo ({start_date} to {end_date})...")
    all_weather = []
    
    # Sample 10 diverse locations
    sample_locations = random.sample(locations, min(10, len(locations)))
    
    for loc in sample_locations:
        try:
            url = "https://archive-api.open-meteo.com/v1/archive"
            params = {
                "latitude": loc["lat"],
                "longitude": loc["lon"],
                "start_date": start_date,
                "end_date": end_date,
                "hourly": "temperature_2m,relative_humidity_2m,precipitation,surface_pressure,wind_speed_10m",
                "timezone": "Europe/London",
            }
            resp = requests.get(url, params=params, timeout=60)
            if resp.status_code != 200:
                print(f"  Weather API returned {resp.status_code} for {loc['name']}")
                continue
            
            data = resp.json()
            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            temps = hourly.get("temperature_2m", [])
            humidity = hourly.get("relative_humidity_2m", [])
            precip = hourly.get("precipitation", [])
            pressure = hourly.get("surface_pressure", [])
            wind = hourly.get("wind_speed_10m", [])
            
            # Sample every 6 hours to keep data manageable
            for i in range(0, len(times), 6):
                if i < len(times):
                    all_weather.append({
                        "timestamp": times[i],
                        "location_name": loc["name"],
                        "latitude": loc["lat"],
                        "longitude": loc["lon"],
                        "temperature_c": temps[i] if i < len(temps) and temps[i] is not None else None,
                        "rainfall_mm": precip[i] if i < len(precip) and precip[i] is not None else 0,
                        "humidity_percent": humidity[i] if i < len(humidity) and humidity[i] is not None else None,
                        "wind_speed_ms": round(wind[i] / 3.6, 2) if i < len(wind) and wind[i] is not None else None,
                        "pressure_hpa": pressure[i] if i < len(pressure) and pressure[i] is not None else None,
                        "source": "open-meteo-archive",
                    })
            
            print(f"  {loc['name']}: {len(times)} hours fetched")
            time.sleep(0.3)  # Rate limit courtesy
            
        except Exception as e:
            print(f"  Failed for {loc['name']}: {e}")
    
    print(f"  Total weather observations: {len(all_weather)}")
    return all_weather

# Report Generator
CATEGORY_MAP = {
    "flood": {
        "incident_category": "flood",
        "incident_subtype": ["river_flood", "flash_flood", "coastal_flood", "surface_water", "groundwater"],
        "display_type": ["Flood", "River Flood", "Flash Flood", "Surface Water Flooding", "Coastal Surge"],
        "descriptions": FLOOD_DESCRIPTIONS,
        "weight": 0.30,
    },
    "storm": {
        "incident_category": "storm",
        "incident_subtype": ["severe_wind", "thunderstorm", "winter_storm", "tornado", "hailstorm"],
        "display_type": ["Severe Storm", "Thunderstorm", "Winter Storm", "Wind Damage", "Hailstorm"],
        "descriptions": STORM_DESCRIPTIONS,
        "weight": 0.20,
    },
    "heatwave": {
        "incident_category": "heatwave",
        "incident_subtype": ["extreme_heat", "heat_health", "infrastructure_heat", "water_stress"],
        "display_type": ["Heatwave", "Extreme Temperature", "Heat Emergency", "Heat Health Alert"],
        "descriptions": HEATWAVE_DESCRIPTIONS,
        "weight": 0.12,
    },
    "wildfire": {
        "incident_category": "wildfire",
        "incident_subtype": ["moorland_fire", "grass_fire", "forest_fire", "peat_fire", "heathland_fire"],
        "display_type": ["Wildfire", "Grass Fire", "Moorland Fire", "Forest Fire", "Heathland Fire"],
        "descriptions": WILDFIRE_DESCRIPTIONS,
        "weight": 0.10,
    },
    "drought": {
        "incident_category": "drought",
        "incident_subtype": ["agricultural_drought", "water_supply", "ecological_drought", "hydrological"],
        "display_type": ["Drought", "Water Shortage", "Agricultural Drought", "Reservoir Alert"],
        "descriptions": DROUGHT_DESCRIPTIONS,
        "weight": 0.10,
    },
    "other": {
        "incident_category": "other",
        "incident_subtype": ["chemical_spill", "gas_leak", "structural", "rtc", "landslide", "power_outage"],
        "display_type": ["Incident", "Infrastructure Failure", "Environmental Hazard", "Public Safety", "Landslide"],
        "descriptions": OTHER_DESCRIPTIONS,
        "weight": 0.18,
    },
}

SEVERITY_WEIGHTS = {"low": 0.25, "medium": 0.35, "high": 0.30, "critical": 0.10}
STATUS_OPTIONS = ["verified", "resolved", "unverified", "urgent", "flagged"]
STATUS_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08]

def generate_reports(n=1200, hf_data=None):
    """Generate n realistic disaster reports."""
    print(f"Generating {n} disaster reports...")
    
    reports = []
    categories = list(CATEGORY_MAP.keys())
    cat_weights = [CATEGORY_MAP[c]["weight"] for c in categories]
    severities = list(SEVERITY_WEIGHTS.keys())
    sev_weights = list(SEVERITY_WEIGHTS.values())
    
    # Create a pool of reporter IPs for realistic reporter_scores
    reporter_ips = [f"192.168.{random.randint(1,254)}.{random.randint(1,254)}" for _ in range(200)]
    reporter_names = [
        "John Smith", "Sarah Jones", "Mike Wilson", "Emma Brown", "David Taylor",
        "Lisa Anderson", "James Martin", "Claire White", "Robert Harris", "Helen Clark",
        "Daniel Lewis", "Susan Walker", "Paul Robinson", "Mary Hall", "Mark Allen",
        "Laura Young", "Peter King", "Rachel Wright", "Andrew Scott", "Julie Baker",
        "Chris Green", "Karen Adams", "Tom Nelson", "Fiona Hill", "Steve Morris",
        "Jane Mitchell", "Ian Campbell", "Donna Phillips", "Gary Evans", "Angela Turner",
        "Anonymous", "Anonymous", "Anonymous", "Concerned Citizen", "Local Resident",
        "Council Worker", "Emergency Responder", "Ambulance Crew", "Police Officer",
    ]
    
    # Generate reports spanning 2 years
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=730)
    
    hf_texts = []
    if hf_data:
        for row in hf_data:
            msg = row.get("message", row.get("text", row.get("tweet_text", "")))
            if msg and len(msg) > 20:
                hf_texts.append(msg)
    
    for i in range(n):
        cat_name = random.choices(categories, weights=cat_weights, k=1)[0]
        cat = CATEGORY_MAP[cat_name]
        
        location = random.choice(UK_LOCATIONS)
        severity = random.choices(severities, weights=sev_weights, k=1)[0]
        status = random.choices(STATUS_OPTIONS, weights=STATUS_WEIGHTS, k=1)[0]
        
        # Generate description
        if hf_texts and random.random() < 0.15:
            # 15% chance to use real HuggingFace crisis text, adapted
            base_text = random.choice(hf_texts)
            description = f"{base_text} [Reported near {location['name']}]"
        else:
            description = fill_template(random.choice(cat["descriptions"]), location)
        
        # Add jitter to coordinates (within ~1km)
        lat = location["lat"] + random.uniform(-0.01, 0.01)
        lon = location["lon"] + random.uniform(-0.01, 0.01)
        
        # Random timestamp within 2 years
        days_offset = random.uniform(0, 730)
        created_at = start + timedelta(days=days_offset)
        
        # AI confidence varies by status
        if status in ("verified", "resolved"):
            ai_confidence = round(random.uniform(60, 98), 2)
        elif status == "urgent":
            ai_confidence = round(random.uniform(70, 95), 2)
        elif status == "flagged":
            ai_confidence = round(random.uniform(20, 50), 2)
        else:
            ai_confidence = round(random.uniform(30, 85), 2)
        
        # AI analysis JSONB
        is_flood = 1 if cat_name == "flood" else 0
        ai_analysis = {
            "flood_class": is_flood,
            "category_confidence": round(ai_confidence / 100, 3),
            "nlp_sentiment": round(random.uniform(-0.8, -0.1), 3),
            "keywords_detected": random.sample(
                ["flood", "water", "damage", "emergency", "rescue", "fire", "heat", "storm", "wind", "rain"],
                k=random.randint(2, 5)
            ),
        }
        
        reporter_ip = random.choice(reporter_ips)
        ip_hash = hashlib.sha256(reporter_ip.encode()).hexdigest()[:45]
        
        has_media_flag = random.random() < 0.4
        report_id = str(uuid.uuid4())
        report_number = f"AEGIS-{created_at.strftime('%Y%m%d')}-{random.randint(1000, 9999)}"
        
        reports.append({
            "id": report_id,
            "report_number": report_number,
            "incident_category": cat["incident_category"],
            "incident_subtype": random.choice(cat["incident_subtype"]),
            "display_type": random.choice(cat["display_type"]),
            "description": description,
            "severity": severity,
            "status": status,
            "trapped_persons": str(random.randint(0, 5)) if severity in ("high", "critical") and random.random() < 0.3 else "0",
            "location_text": location["name"],
            "lat": lat,
            "lon": lon,
            "has_media": has_media_flag,
            "media_type": random.choice(["image/jpeg", "image/png", "video/mp4"]) if has_media_flag else None,
            "reporter_name": random.choice(reporter_names),
            "reporter_ip": ip_hash,
            "ai_confidence": ai_confidence,
            "ai_analysis": json.dumps(ai_analysis),
            "region_id": location.get("region", "uk-default"),
            "incident_type": cat_name,
            "created_at": created_at,
        })
    
    # Print category distribution
    cat_counts = {}
    sev_counts = {}
    for r in reports:
        cat_counts[r["incident_category"]] = cat_counts.get(r["incident_category"], 0) + 1
        sev_counts[r["severity"]] = sev_counts.get(r["severity"], 0) + 1
    
    print("  Category distribution:")
    for cat, count in sorted(cat_counts.items()):
        print(f"    {cat}: {count}")
    print("  Severity distribution:")
    for sev, count in sorted(sev_counts.items()):
        print(f"    {sev}: {count}")
    
    return reports

def generate_reporter_scores(reports):
    """Generate reporter_scores based on inserted reports."""
    print("Generating reporter scores...")
    
    # Group by reporter IP
    ip_stats = {}
    for r in reports:
        ip = r["reporter_ip"]
        if ip not in ip_stats:
            ip_stats[ip] = {"total": 0, "genuine": 0, "flagged": 0, "fake": 0, "confidences": []}
        ip_stats[ip]["total"] += 1
        ip_stats[ip]["confidences"].append(r["ai_confidence"])
        if r["status"] in ("verified", "resolved"):
            ip_stats[ip]["genuine"] += 1
        elif r["status"] == "flagged":
            ip_stats[ip]["flagged"] += 1
    
    scores = []
    for ip_hash, stats in ip_stats.items():
        genuine_ratio = stats["genuine"] / max(stats["total"], 1)
        # Trust score: genuine ratio + noise
        trust = min(1.0, max(0.0, genuine_ratio + random.uniform(-0.15, 0.15)))
        
        # Some reporters are suspicious (low trust)
        if random.random() < 0.08:
            trust = round(random.uniform(0.05, 0.24), 4)
            stats["fake"] = random.randint(1, 3)
        
        scores.append({
            "id": str(uuid.uuid4()),
            "fingerprint_hash": hashlib.sha256(f"fp-{ip_hash}".encode()).hexdigest()[:45],
            "ip_hash": ip_hash,
            "total_reports": stats["total"],
            "genuine_reports": stats["genuine"],
            "flagged_reports": stats["flagged"],
            "fake_reports": stats["fake"],
            "avg_confidence": round(sum(stats["confidences"]) / len(stats["confidences"]), 2),
            "trust_score": round(trust, 4),
            "last_report_at": datetime.now(timezone.utc) - timedelta(days=random.randint(0, 60)),
        })
    
    # Stats
    low_trust = sum(1 for s in scores if s["trust_score"] < 0.25)
    print(f"  Generated {len(scores)} reporter scores ({low_trust} suspicious / low-trust)")
    return scores

def generate_flood_archives():
    """Generate realistic UK flood archive data for damage cost regression."""
    print("Generating flood archives...")
    
    archives = [
        # Real UK flood events with approximate data
        {"severity": "critical", "affected_people": 55000, "damage_gbp": 3400000000, "affected_area_km2": 2500, "region": "Yorkshire & Humber"},
        {"severity": "critical", "affected_people": 48000, "damage_gbp": 1300000000, "affected_area_km2": 1800, "region": "Cumbria"},
        {"severity": "high", "affected_people": 16000, "damage_gbp": 276000000, "affected_area_km2": 800, "region": "Worcestershire"},
        {"severity": "high", "affected_people": 11000, "damage_gbp": 500000000, "affected_area_km2": 1200, "region": "Somerset Levels"},
        {"severity": "critical", "affected_people": 8000, "damage_gbp": 417000000, "affected_area_km2": 600, "region": "Greater Manchester"},
        {"severity": "high", "affected_people": 6500, "damage_gbp": 180000000, "affected_area_km2": 400, "region": "Tewkesbury"},
        {"severity": "medium", "affected_people": 3200, "damage_gbp": 45000000, "affected_area_km2": 200, "region": "Edinburgh"},
        {"severity": "medium", "affected_people": 2800, "damage_gbp": 62000000, "affected_area_km2": 150, "region": "Carlisle"},
        {"severity": "high", "affected_people": 7300, "damage_gbp": 320000000, "affected_area_km2": 900, "region": "East Anglia"},
        {"severity": "low", "affected_people": 450, "damage_gbp": 8000000, "affected_area_km2": 30, "region": "Thames Valley"},
        {"severity": "medium", "affected_people": 1800, "damage_gbp": 35000000, "affected_area_km2": 120, "region": "Mid Wales"},
        {"severity": "low", "affected_people": 320, "damage_gbp": 5500000, "affected_area_km2": 15, "region": "Scottish Borders"},
        {"severity": "high", "affected_people": 9100, "damage_gbp": 250000000, "affected_area_km2": 700, "region": "South Yorkshire"},
        {"severity": "medium", "affected_people": 2100, "damage_gbp": 42000000, "affected_area_km2": 180, "region": "Devon"},
        {"severity": "critical", "affected_people": 22000, "damage_gbp": 800000000, "affected_area_km2": 1400, "region": "Lancashire"},
        {"severity": "low", "affected_people": 600, "damage_gbp": 12000000, "affected_area_km2": 45, "region": "Kent"},
        {"severity": "high", "affected_people": 5400, "damage_gbp": 150000000, "affected_area_km2": 350, "region": "Shropshire"},
        {"severity": "medium", "affected_people": 1500, "damage_gbp": 28000000, "affected_area_km2": 90, "region": "Nottinghamshire"},
        {"severity": "low", "affected_people": 280, "damage_gbp": 4200000, "affected_area_km2": 20, "region": "Norfolk"},
        {"severity": "high", "affected_people": 4300, "damage_gbp": 95000000, "affected_area_km2": 270, "region": "Gloucestershire"},
        {"severity": "medium", "affected_people": 1900, "damage_gbp": 38000000, "affected_area_km2": 130, "region": "Northumberland"},
        {"severity": "critical", "affected_people": 15000, "damage_gbp": 600000000, "affected_area_km2": 1100, "region": "West Yorkshire"},
        {"severity": "low", "affected_people": 200, "damage_gbp": 3800000, "affected_area_km2": 12, "region": "Cornwall"},
        {"severity": "high", "affected_people": 3800, "damage_gbp": 110000000, "affected_area_km2": 220, "region": "Derbyshire"},
        {"severity": "medium", "affected_people": 2400, "damage_gbp": 52000000, "affected_area_km2": 160, "region": "Dorset"},
    ]
    
    print(f"  Generated {len(archives)} flood archive records")
    return archives

def generate_fusion_computations(reports):
    """Generate synthetic but realistic fusion computation data."""
    print("Generating fusion computations...")
    
    computations = []
    # Use verified/resolved reports as basis
    verified = [r for r in reports if r["status"] in ("verified", "resolved")]
    sample = random.sample(verified, min(200, len(verified)))
    
    for r in sample:
        # Generate realistic normalised input values
        is_flood = r["incident_category"] == "flood"
        severity_boost = {"low": 0.0, "medium": 0.2, "high": 0.4, "critical": 0.6}
        boost = severity_boost.get(r["severity"], 0.2)
        
        def make_input(base_range, flood_boost=0.0):
            val = random.uniform(*base_range) + (flood_boost if is_flood else 0)
            return json.dumps({"normalised": round(min(1.0, max(0.0, val + boost * random.uniform(-0.1, 0.3))), 4)})
        
        fused_prob = random.uniform(0.2, 0.95) if is_flood else random.uniform(0.05, 0.5)
        
        computations.append({
            "id": str(uuid.uuid4()),
            "region_id": r["id"],
            "hazard_type": r["incident_category"] if r["incident_category"] in ("flood", "storm", "drought", "heatwave", "wildfire") else "flood",
            "water_level_input": make_input((0.1, 0.6), 0.3),
            "rainfall_input": make_input((0.05, 0.7), 0.2),
            "gauge_delta_input": make_input((0.0, 0.5), 0.2),
            "soil_saturation_input": make_input((0.2, 0.8), 0.1),
            "citizen_nlp_input": make_input((0.1, 0.7), 0.15),
            "historical_match_input": make_input((0.05, 0.6), 0.2),
            "terrain_input": make_input((0.1, 0.5), 0.1),
            "photo_cnn_input": make_input((0.0, 0.4), 0.3),
            "seasonal_input": make_input((0.1, 0.6), 0.1),
            "urban_density_input": make_input((0.2, 0.7), 0.0),
            "fused_probability": round(fused_prob, 4),
            "fused_confidence": round(random.uniform(0.5, 0.95), 4),
            "feature_weights": json.dumps({
                "water_level": round(random.uniform(0.1, 0.3), 3),
                "rainfall": round(random.uniform(0.1, 0.25), 3),
                "gauge_delta": round(random.uniform(0.05, 0.15), 3),
                "soil_saturation": round(random.uniform(0.05, 0.15), 3),
                "citizen_nlp": round(random.uniform(0.05, 0.15), 3),
                "historical_match": round(random.uniform(0.05, 0.1), 3),
                "terrain": round(random.uniform(0.02, 0.08), 3),
                "photo_cnn": round(random.uniform(0.02, 0.1), 3),
                "seasonal": round(random.uniform(0.02, 0.08), 3),
                "urban_density": round(random.uniform(0.02, 0.08), 3),
            }),
            "model_version": "fusion-v2.1",
            "computation_time_ms": random.randint(15, 350),
            "created_at": r["created_at"],
        })
    
    print(f"  Generated {len(computations)} fusion computations")
    return computations

def generate_historical_floods():
    """Generate additional historical flood events for the UK."""
    print("Generating additional historical flood events...")
    
    events = [
        {"event_name": "Storm Desmond 2015", "date": "2015-12-05", "lat": 54.6612, "lon": -3.3620, "severity": "critical",
         "description": "Record-breaking rainfall caused devastating flooding across Cumbria and Lancashire. Over 5,200 homes flooded.",
         "affected_area_km2": 2500, "estimated_damage_gbp": 520000000, "casualties": 0, "region": "Cumbria"},
        {"event_name": "Boxing Day Floods 2015", "date": "2015-12-26", "lat": 53.8008, "lon": -1.5491, "severity": "critical",
         "description": "Major flooding across Yorkshire and Lancashire. Leeds, York, and surrounding areas severely impacted. River Aire breached defences.",
         "affected_area_km2": 3000, "estimated_damage_gbp": 1600000000, "casualties": 0, "region": "Yorkshire"},
        {"event_name": "Summer Floods 2007", "date": "2007-07-20", "lat": 51.8642, "lon": -2.2382, "severity": "critical",
         "description": "Widespread flooding across England. Tewkesbury, Sheffield, Hull severely affected. 55,000 properties flooded. Largest inland flood event since 1947.",
         "affected_area_km2": 5000, "estimated_damage_gbp": 3200000000, "casualties": 13, "region": "England-wide"},
        {"event_name": "Storm Ciara 2020", "date": "2020-02-09", "lat": 53.7420, "lon": -2.0122, "severity": "high",
         "description": "Severe storm bringing heavy rain and winds up to 97mph. Flooding in Calder Valley, South Wales, and Yorkshire.",
         "affected_area_km2": 1500, "estimated_damage_gbp": 360000000, "casualties": 0, "region": "Northern England"},
        {"event_name": "Storm Dennis 2020", "date": "2020-02-15", "lat": 51.4816, "lon": -3.1791, "severity": "critical",
         "description": "Record river levels across Wales and England. Largest number of flood warnings ever issued simultaneously in the UK.",
         "affected_area_km2": 4000, "estimated_damage_gbp": 460000000, "casualties": 3, "region": "Wales & England"},
        {"event_name": "Carlisle Floods 2005", "date": "2005-01-08", "lat": 54.8925, "lon": -2.9329, "severity": "critical",
         "description": "Major flooding from River Eden. 1,844 properties flooded. Three fatalities. City centre submerged for several days.",
         "affected_area_km2": 400, "estimated_damage_gbp": 250000000, "casualties": 3, "region": "Cumbria"},
        {"event_name": "Boscastle Flash Flood 2004", "date": "2004-08-16", "lat": 50.6836, "lon": -4.6920, "severity": "high",
         "description": "Devastating flash flood in Boscastle. 75mm of rain in 2 hours. Buildings destroyed. Miraculous no fatalities.",
         "affected_area_km2": 20, "estimated_damage_gbp": 20000000, "casualties": 0, "region": "Cornwall"},
        {"event_name": "London Floods 2021", "date": "2021-07-12", "lat": 51.5074, "lon": -0.1278, "severity": "high",
         "description": "Flash flooding across London from intense thunderstorms. Tube stations flooded. Hospitals evacuated. 1,500+ properties damaged.",
         "affected_area_km2": 300, "estimated_damage_gbp": 180000000, "casualties": 0, "region": "London"},
        {"event_name": "Todmorden Floods 2012", "date": "2012-06-22", "lat": 53.7133, "lon": -2.0971, "severity": "high",
         "description": "Major flooding in Calder Valley. Multiple landslides. Road and rail infrastructure severely damaged.",
         "affected_area_km2": 150, "estimated_damage_gbp": 40000000, "casualties": 0, "region": "West Yorkshire"},
        {"event_name": "Somerset Levels 2013-14", "date": "2014-01-06", "lat": 51.0760, "lon": -2.9140, "severity": "critical",
         "description": "Prolonged flooding of Somerset Levels lasting 3+ months. Villages cut off. Major military deployment for pumping operations.",
         "affected_area_km2": 650, "estimated_damage_gbp": 147000000, "casualties": 0, "region": "Somerset"},
        {"event_name": "Morpeth Floods 2008", "date": "2008-09-06", "lat": 55.1676, "lon": -1.6868, "severity": "high",
         "description": "River Wansbeck burst banks causing severe flooding in Morpeth town centre. Over 1,000 properties flooded.",
         "affected_area_km2": 80, "estimated_damage_gbp": 35000000, "casualties": 0, "region": "Northumberland"},
        {"event_name": "Aberystwyth Storms 2014", "date": "2014-01-06", "lat": 52.4153, "lon": -4.0829, "severity": "high",
         "description": "Severe coastal storms destroyed Victorian seafront promenade. Major damage to infrastructure. Properties evacuated.",
         "affected_area_km2": 50, "estimated_damage_gbp": 8000000, "casualties": 0, "region": "Ceredigion"},
        {"event_name": "Storm Christoph 2021", "date": "2021-01-20", "lat": 53.4808, "lon": -2.2426, "severity": "high",
         "description": "Heavy rainfall causing widespread flooding across Manchester, Didsbury, and surrounding areas. River Mersey at record levels.",
         "affected_area_km2": 800, "estimated_damage_gbp": 120000000, "casualties": 0, "region": "Greater Manchester"},
        {"event_name": "Perth Floods 1993", "date": "1993-01-17", "lat": 56.3950, "lon": -3.4308, "severity": "critical",
         "description": "River Tay flooding in Perth following prolonged rainfall and snowmelt. North Inch submerged. Significant property damage.",
         "affected_area_km2": 200, "estimated_damage_gbp": 50000000, "casualties": 0, "region": "Perth & Kinross"},
        {"event_name": "Storm Arwen 2021", "date": "2021-11-26", "lat": 55.4, "lon": -2.0, "severity": "high",
         "description": "Extreme winds up to 100mph across northern England and Scotland. One million homes lost power. Extensive tree damage.",
         "affected_area_km2": 10000, "estimated_damage_gbp": 300000000, "casualties": 3, "region": "Northern UK"},
    ]
    
    print(f"  Generated {len(events)} historical flood events")
    return events

# Database Insertion
def insert_all(conn, reports, reporter_scores, weather, flood_archives, fusion_comps, flood_events):
    """Insert all generated data into the database."""
    cur = conn.cursor()
    
    try:
        # 1. Insert reports
        print(f"\nInserting {len(reports)} reports...")
        report_sql = """
            INSERT INTO reports (
                id, report_number, incident_category, incident_subtype, display_type,
                description, severity, status, trapped_persons, location_text,
                coordinates, has_media, media_type, reporter_name, reporter_ip,
                ai_confidence, ai_analysis, region_id, created_at
            ) VALUES (
                %(id)s, %(report_number)s, %(incident_category)s, %(incident_subtype)s, %(display_type)s,
                %(description)s, %(severity)s::report_severity, %(status)s::report_status, %(trapped_persons)s, %(location_text)s,
                ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), %(has_media)s, %(media_type)s, %(reporter_name)s, %(reporter_ip)s,
                %(ai_confidence)s, %(ai_analysis)s::jsonb, %(region_id)s, %(created_at)s
            )
            ON CONFLICT (id) DO NOTHING
        """
        
        batch_size = 100
        for i in range(0, len(reports), batch_size):
            batch = reports[i:i+batch_size]
            try:
                psycopg2.extras.execute_batch(cur, report_sql, batch)
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"  Batch {i//batch_size} failed: {e}")
                # Try inserting one by one to find problem rows
                for r in batch:
                    try:
                        cur.execute(report_sql, r)
                        conn.commit()
                    except Exception as e2:
                        conn.rollback()
                        # Skip this row
        
        cur.execute("SELECT COUNT(*) FROM reports")
        count = cur.fetchone()[0]
        print(f"  Reports in DB: {count}")
        
        # 2. Insert reporter_scores
        print(f"\nInserting {len(reporter_scores)} reporter scores...")
        rs_sql = """
            INSERT INTO reporter_scores (
                id, fingerprint_hash, ip_hash, total_reports, genuine_reports,
                flagged_reports, fake_reports, avg_confidence, trust_score, last_report_at
            ) VALUES (
                %(id)s, %(fingerprint_hash)s, %(ip_hash)s, %(total_reports)s, %(genuine_reports)s,
                %(flagged_reports)s, %(fake_reports)s, %(avg_confidence)s, %(trust_score)s, %(last_report_at)s
            )
            ON CONFLICT DO NOTHING
        """
        psycopg2.extras.execute_batch(cur, rs_sql, reporter_scores)
        conn.commit()
        
        cur.execute("SELECT COUNT(*) FROM reporter_scores")
        count = cur.fetchone()[0]
        print(f"  Reporter scores in DB: {count}")
        
        # 3. Insert weather observations
        if weather:
            print(f"\nInserting {len(weather)} weather observations...")
            wx_sql = """
                INSERT INTO weather_observations (
                    timestamp, location_name, latitude, longitude,
                    temperature_c, rainfall_mm, humidity_percent,
                    wind_speed_ms, pressure_hpa, source
                ) VALUES (
                    %(timestamp)s, %(location_name)s, %(latitude)s, %(longitude)s,
                    %(temperature_c)s, %(rainfall_mm)s, %(humidity_percent)s,
                    %(wind_speed_ms)s, %(pressure_hpa)s, %(source)s
                )
                ON CONFLICT (timestamp, latitude, longitude) DO NOTHING
            """
            for i in range(0, len(weather), 500):
                batch = weather[i:i+500]
                try:
                    psycopg2.extras.execute_batch(cur, wx_sql, batch)
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    print(f"  Weather batch failed: {e}")
            
            cur.execute("SELECT COUNT(*) FROM weather_observations")
            count = cur.fetchone()[0]
            print(f"  Weather observations in DB: {count}")
        
        # 4. Insert flood archives
        print(f"\nInserting {len(flood_archives)} flood archives...")
        # Check if flood_archives table exists, create if needed
        cur.execute("""
            CREATE TABLE IF NOT EXISTS flood_archives (
                id SERIAL PRIMARY KEY,
                severity VARCHAR(20),
                affected_people INTEGER,
                damage_gbp NUMERIC,
                affected_area_km2 NUMERIC,
                region VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        conn.commit()
        
        fa_sql = """
            INSERT INTO flood_archives (severity, affected_people, damage_gbp, affected_area_km2, region)
            VALUES (%(severity)s, %(affected_people)s, %(damage_gbp)s, %(affected_area_km2)s, %(region)s)
        """
        psycopg2.extras.execute_batch(cur, fa_sql, flood_archives)
        conn.commit()
        
        cur.execute("SELECT COUNT(*) FROM flood_archives")
        count = cur.fetchone()[0]
        print(f"  Flood archives in DB: {count}")
        
        # 5. Insert fusion computations
        print(f"\nInserting {len(fusion_comps)} fusion computations...")
        fc_sql = """
            INSERT INTO fusion_computations (
                id, region_id, hazard_type, water_level_input, rainfall_input, gauge_delta_input,
                soil_saturation_input, citizen_nlp_input, historical_match_input,
                terrain_input, photo_cnn_input, seasonal_input, urban_density_input,
                fused_probability, fused_confidence, feature_weights,
                model_version, computation_time_ms, created_at
            ) VALUES (
                %(id)s, %(region_id)s, %(hazard_type)s, %(water_level_input)s::jsonb, %(rainfall_input)s::jsonb, %(gauge_delta_input)s::jsonb,
                %(soil_saturation_input)s::jsonb, %(citizen_nlp_input)s::jsonb, %(historical_match_input)s::jsonb,
                %(terrain_input)s::jsonb, %(photo_cnn_input)s::jsonb, %(seasonal_input)s::jsonb, %(urban_density_input)s::jsonb,
                %(fused_probability)s, %(fused_confidence)s, %(feature_weights)s::jsonb,
                %(model_version)s, %(computation_time_ms)s, %(created_at)s
            )
            ON CONFLICT (id) DO NOTHING
        """
        psycopg2.extras.execute_batch(cur, fc_sql, fusion_comps)
        conn.commit()
        
        cur.execute("SELECT COUNT(*) FROM fusion_computations")
        count = cur.fetchone()[0]
        print(f"  Fusion computations in DB: {count}")
        
        # 6. Insert historical flood events
        print(f"\nInserting {len(flood_events)} historical flood events...")
        fe_sql = """
            INSERT INTO historical_flood_events (
                event_name, event_date, area, severity, coordinates,
                affected_people, damage_gbp, feature_vector, source
            ) VALUES (
                %(event_name)s, %(date)s, %(area)s, %(severity)s,
                ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                %(affected_people)s, %(damage_gbp)s, %(feature_vector)s::jsonb, %(source)s
            )
        """
        for evt in flood_events:
            try:
                cur.execute(fe_sql, evt)
                conn.commit()
            except Exception as e:
                conn.rollback()
        
        cur.execute("SELECT COUNT(*) FROM historical_flood_events")
        count = cur.fetchone()[0]
        print(f"  Historical flood events in DB: {count}")
        
        # 7. Final summary
        print("\n" + "=" * 60)
        print("SEEDING COMPLETE - Final Database Counts:")
        print("=" * 60)
        
        tables = [
            "reports", "reporter_scores", "weather_observations",
            "flood_archives", "fusion_computations", "historical_flood_events",
            "ai_predictions", "ai_model_metrics"
        ]
        for t in tables:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {t}")
                count = cur.fetchone()[0]
                print(f"  {t}: {count}")
            except Exception:
                conn.rollback()
                print(f"  {t}: (table not found)")
        
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()

# Main
def main():
    print("=" * 60)
    print("AEGIS World-Class Data Seeder")
    print("=" * 60)
    
    # Connect to DB
    print("\nConnecting to PostgreSQL...")
    conn = psycopg2.connect(DB_URL)
    print("  Connected!")
    
    # Check current state
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM reports")
    existing = cur.fetchone()[0]
    cur.close()
    
    if existing > 500:
        print(f"\n  DB already has {existing} reports. Skipping seed.")
        print("  To re-seed, first run: DELETE FROM reports;")
        conn.close()
        return
    
    # 1. Try to fetch HuggingFace data
    hf_data = fetch_huggingface_crisis_data()
    
    # 2. Fetch historical weather data (last 6 months)
    end_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=185)).strftime("%Y-%m-%d")
    weather = fetch_weather_data(UK_LOCATIONS, start_date, end_date)
    
    # 3. Generate reports
    reports = generate_reports(n=1200, hf_data=hf_data)
    
    # 4. Generate reporter scores from reports
    reporter_scores = generate_reporter_scores(reports)
    
    # 5. Generate flood archives
    flood_archives = generate_flood_archives()
    
    # 6. Generate fusion computations
    fusion_comps = generate_fusion_computations(reports)
    
    # 7. Generate historical flood events
    flood_events = generate_historical_floods()
    # Post-process to match actual DB schema
    for evt in flood_events:
        evt["area"] = evt.get("region", "UK")
        evt["affected_people"] = evt.get("affected_people", 0) or evt.get("casualties", 0) * 100
        evt["damage_gbp"] = evt.get("estimated_damage_gbp", 0)
        evt["feature_vector"] = json.dumps({"description": evt.get("description", ""), "affected_area_km2": evt.get("affected_area_km2", 0)})
        evt["source"] = "historical-records"
    
    # 8. Insert everything
    insert_all(conn, reports, reporter_scores, weather, flood_archives, fusion_comps, flood_events)
    
    conn.close()
    print("\nDone! Database is ready for world-class AI training.")

if __name__ == "__main__":
    main()

