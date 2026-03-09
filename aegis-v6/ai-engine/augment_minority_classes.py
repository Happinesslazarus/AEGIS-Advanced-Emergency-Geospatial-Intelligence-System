"""
Augment minority class data for the report classifier.
Generates real-world-style descriptions for non-flood categories.
"""
import asyncio
import asyncpg
import os
import random
from datetime import datetime, timedelta, timezone

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')

# Rich, diverse descriptions for each hazard type
CATEGORY_TEMPLATES = {
    'storm': [
        "Severe storm damage reported. Trees uprooted blocking main road. Power lines down.",
        "High winds causing structural damage to roofs. Multiple properties affected in residential area.",
        "Thunderstorm with large hail damaging vehicles and greenhouses in farming district.",
        "Storm surge flooding coastal road. Sea defences breached near harbour wall.",
        "Tornado-like winds ripped through the park, several large oaks uprooted, blocking emergency access.",
        "Lightning strike caused electrical fire in commercial building during overnight storm.",
        "Gale force winds blowing debris across motorway. Multiple lane closures reported by highways agency.",
        "Heavy storm overnight has left significant damage to community centre roof and fencing.",
        "Extreme wind gusts measured at 80mph. Scaffolding collapsed near construction site, road closed.",
        "Violent storm left trail of destruction across three villages. Emergency shelters activated.",
        "Storm damage to railway signaling equipment causing major disruption to train services.",
        "Strong winds have blown a tree onto a bus shelter, glass everywhere, pedestrian injuries reported.",
        "Cyclonic winds tearing through retail park, shop signs and debris flying dangerously.",
        "Storm brought down transmission tower near substation, widespread power outage reported.",
        "Hurricane-force gusts causing roof tiles to become projectiles in housing estate.",
        "Severe thunderstorm with flash flooding and wind damage across the borough.",
        "Wind shear damaged aircraft hangars at local airfield. Structural assessment needed.",
        "Storm front moving east with sustained 60mph winds and heavy rain. Schools closed early.",
        "Micro-burst event caused localised but severe damage to greenhouse complex and farm buildings.",
        "Post-storm assessment shows 47 properties with structural damage. Council deploying repair teams.",
    ],
    'heatwave': [
        "Extreme heat warning issued. Temperatures exceeding 38°C for third consecutive day.",
        "Heat stroke cases reported at outdoor event. Several hospitalised, emergency cooling stations set up.",
        "Tarmac melting on major road causing traffic hazards. Speed restrictions in place.",
        "Water reservoir levels critically low due to prolonged heatwave. Usage restrictions imminent.",
        "Elderly residents at care home suffering heat exhaustion. Air conditioning units failed.",
        "Railway tracks buckled in extreme heat, all services suspended on three lines.",
        "Forest fire risk elevated to extreme. Countryside access restricted by fire service.",
        "Urban heat island effect making city centre dangerous. Homeless support services overwhelmed.",
        "Crop failure reported across multiple farms due to sustained 40°C temperatures and no rainfall.",
        "Swimming pool and splash parks overcrowded. Council opening additional cooling centres.",
        "Hospital admissions up 40% with heat-related illness. NHS declares critical incident.",
        "Playground surfaces too hot for children. Burns risk from metal equipment. Parks team installing shade.",
        "Power grid under extreme demand from cooling systems. Rolling blackouts possible this evening.",
        "Scorching temperatures causing spontaneous combustion of dry vegetation near residential zones.",
        "Record-breaking heat of 42°C recorded at weather station. Public advised to stay indoors.",
        "Livestock suffering in extreme heat. Veterinary services stretched across agricultural regions.",
        "Heatwave causing expansion damage to bridge joints on the A-road. Weight restrictions imposed.",
        "Public health emergency declared as heat index reaches 45°C with high humidity.",
        "Mass fish die-off in river due to low oxygen levels from extreme water temperatures.",
        "Unprecedented overnight minimum of 28°C preventing vulnerable residents from recovering.",
    ],
    'drought': [
        "Severe drought conditions. River levels at historic low. Fish rescue operations underway.",
        "Agricultural drought declared. Crop irrigation severely restricted. Farmers applying for emergency aid.",
        "Water supply threatened. Reservoir at 23% capacity. Hosepipe ban extended to all regions.",
        "Ground subsidence due to drought causing structural cracks in multiple residential properties.",
        "Drought affecting water quality. Treatment works struggling with low flow and concentrated pollutants.",
        "Wells and boreholes running dry in rural communities. Emergency water tanker deliveries arranged.",
        "Peatland fires erupting on moorland due to exceptionally dry conditions. Fire crews deployed.",
        "Drought-stressed trees falling without warning in urban parks. Multiple closures for safety inspections.",
        "Livestock culling required due to insufficient water and grazing. Farming community in crisis.",
        "Canal system at unprecedented low levels. Navigation suspended. Ecological damage to aquatic habitats.",
        "Prolonged dry spell causing soil compaction and dust storms from bare agricultural fields.",
        "Water rationing introduced for businesses and households. Four-hour supply windows announced.",
        "Drought damage to heritage buildings as clay soil shrinks beneath foundations.",
        "River abstraction licences suspended. Industrial users facing production shutdowns.",
        "Algal blooms in stagnant reservoirs creating health hazard. Swimming and fishing banned.",
        "Three months without significant rainfall. Wildfire risk escalated across heathland areas.",
        "Emergency desalination units being deployed to supplement failing freshwater supply.",
        "Drought impact assessment shows £50M in agricultural losses across the county so far.",
        "Subsidence from drought cracking water mains, worsening water loss in distribution network.",
        "Exceptional drought causing ancient wetlands to dry completely. Environmental catastrophe feared.",
    ],
    'wildfire': [
        "Large wildfire spreading across heathland. Properties being evacuated in surrounding villages.",
        "Grass fire ignited near railway embankment. Smoke reducing visibility on adjacent motorway.",
        "Major moorland fire covering 200 hectares. Helicopter support requested for aerial water drops.",
        "Wildfire approaching residential area. 50 homes evacuated. Emergency shelter opened at leisure centre.",
        "Smoke from wildfire causing severe air quality issues. Residents advised to keep windows closed.",
        "Controlled burn escaped containment. Fire service deploying additional crews to establish new fire line.",
        "Wildfire in forest plantation. Timber losses estimated at several million pounds.",
        "Arson-suspected wildfire in nature reserve. Police and fire investigating. Rare habitats destroyed.",
        "Peat fire burning deep underground spread to surface. Extremely difficult to extinguish.",
        "Wildfire reached power distribution lines. 3,000 properties without electricity.",
        "Crop stubble fire jumped field boundary and is threatening farm buildings and grain store.",
        "Fire crews battling blaze on hillside for third day. Access extremely difficult for vehicles.",
        "Wildfire smoke plume visible from 30 miles away. Aviation warnings issued.",
        "Emergency services evacuating caravan park as fast-moving grass fire approaches from the east.",
        "Wildfire caused by discarded barbecue in tinderbox-dry countryside. Significant habitat loss.",
        "Forest fire destroying ancient woodland. Heritage conservation groups seeking emergency response.",
        "Brush fire along coastal cliffs. Cliff path closed. Risk of cliff collapse from heat damage.",
        "Wildfire in gorse on hillside threatening communications mast serving 10,000 homes.",
        "Two separate wildfires converging. Fire service calling for mutual aid from neighbouring counties.",
        "Post-wildfire assessment: 500 hectares burned, 12 properties damaged, no casualties.",
    ],
    'infrastructure': [
        "Major water main burst flooding residential street. Sinkhole forming at junction.",
        "Gas leak detected near primary school. 200m exclusion zone established. Road closed.",
        "Bridge structural failure detected during routine inspection. Emergency weight restriction imposed.",
        "Sewage overflow contaminating local stream. Environmental Agency investigating, public health alert issued.",
        "Building collapse on high street. Partial facade fell onto pavement. Casualties reported.",
        "Power substation explosion causing widespread blackout. 15,000 homes affected.",
        "Road surface collapsed due to undermining by broken culvert. Major traffic disruption.",
        "Dam inspection reveals critical deterioration. Emergency drawdown ordered as precaution.",
        "Telecommunications tower failure leaving rural communities without phone or internet service.",
        "Flooding from failed drainage infrastructure. Surface water overwhelming urban pumping station.",
        "Railway embankment slip blocking both tracks. Engineering assessment in progress.",
        "Traffic signal system failure at major intersection causing multiple minor collisions.",
        "Retaining wall failure along canal towpath. Properties at risk of subsidence.",
        "Storm drain blockage causing backup into ground floor properties on three streets.",
        "Critical infrastructure alert: water treatment plant operating on backup power after equipment failure.",
        "Electricity pylon leaning dangerously after ground movement. Emergency stay cables being installed.",
        "Sewer collapse under main road creating large void. Emergency repairs to take 5 days.",
        "Footbridge condemned after vandalism damage. Schools and residents lose safe crossing.",
        "Industrial estate access road subsidence. Heavy goods vehicles diverted, businesses affected.",
        "Pumping station failure causing untreated sewage discharge into river. EA major incident declared.",
    ],
}

# UK-ish locations for realism
LOCATIONS = [
    "Manchester", "Leeds", "Birmingham", "Bristol", "Norwich", "Liverpool",
    "Sheffield", "Exeter", "York", "Cardiff", "Newcastle", "Nottingham",
    "Southampton", "Brighton", "Cambridge", "Oxford", "Bath", "Coventry",
    "Wolverhampton", "Derby", "Stoke-on-Trent", "Sunderland", "Plymouth",
    "Reading", "Luton", "Bolton", "Bournemouth", "Stockport", "Middlesbrough",
    "Swansea", "Dundee", "Aberdeen", "Inverness", "Stirling", "Perth",
]

DISPLAY_TYPES = {
    'storm': ['storm damage', 'wind damage', 'severe weather', 'storm', 'gale damage'],
    'heatwave': ['extreme heat', 'heatwave', 'heat emergency', 'high temperature hazard'],
    'drought': ['drought', 'water shortage', 'dry conditions', 'drought emergency'],
    'wildfire': ['wildfire', 'fire', 'vegetation fire', 'bush fire', 'grass fire'],
    'infrastructure': ['infrastructure failure', 'structural damage', 'utility failure', 'collapse'],
}


async def augment_minority_classes():
    conn = await asyncpg.connect(DB_URL)
    try:
        # Check current counts
        rows = await conn.fetch(
            "SELECT incident_category, COUNT(*) as cnt FROM reports WHERE deleted_at IS NULL GROUP BY incident_category"
        )
        current = {r['incident_category']: r['cnt'] for r in rows}
        print("Current distribution:", dict(sorted(current.items(), key=lambda x: -x[1])))

        # Target: 500 per minority class (up from 150)
        TARGET = 500
        inserted_total = 0

        for category, descriptions in CATEGORY_TEMPLATES.items():
            current_count = current.get(category, 0)
            needed = max(0, TARGET - current_count)
            if needed == 0:
                print(f"  {category}: already has {current_count} >= {TARGET}, skipping")
                continue

            print(f"  {category}: {current_count} -> {TARGET} (adding {needed})")
            display_types = DISPLAY_TYPES.get(category, [category])

            for i in range(needed):
                desc = random.choice(descriptions)
                # Add minor variation to avoid exact duplicates
                loc = random.choice(LOCATIONS)
                desc_with_location = f"{desc} Location: {loc} area."

                display_type = random.choice(display_types)
                severity = random.choice(['low', 'medium', 'high'])
                lat = round(random.uniform(50.0, 56.0), 6)
                lon = round(random.uniform(-5.0, 1.5), 6)
                days_ago = random.randint(1, 365)
                created = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0, 23))

                # Generate report_number like existing data: EA + hex
                report_num = f"AUG{random.randint(100000000000, 999999999999):012x}"[:18]
                subtype = f"{category}_general"

                await conn.execute("""
                    INSERT INTO reports (
                        report_number, incident_category, incident_subtype,
                        display_type, description, severity,
                        location_text, coordinates, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7,
                              ST_SetSRID(ST_MakePoint($8::float8, $9::float8), 4326),
                              'verified', $10, $10)
                """, report_num, category, subtype,
                     display_type, desc_with_location, severity,
                     f"{loc}, UK", lon, lat, created)

                inserted_total += 1

        print(f"\nInserted {inserted_total} new reports")

        # Verify final distribution
        rows = await conn.fetch(
            "SELECT incident_category, COUNT(*) as cnt FROM reports WHERE deleted_at IS NULL GROUP BY incident_category ORDER BY cnt DESC"
        )
        print("\nFinal distribution:")
        for r in rows:
            print(f"  {r['incident_category']}: {r['cnt']}")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(augment_minority_classes())
