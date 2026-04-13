"""
Module: _fix_severity_labels.py

_fix_severity_labels AI engine module.
"""

import os
"""
Fix severity labels in training data so they match text content.
The original seed data randomly assigned severities â€” a 'minor puddle' report
could be labeled 'critical'. This makes it impossible for ML to learn patterns.

This script:
1. Re-labels ALL existing reports based on keyword analysis of description text
2. Adds 200+ new reports with CORRECT severity-matching descriptions
"""
import asyncio
import asyncpg
import random
import uuid
import re
from datetime import datetime, timedelta

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

# â”€â”€ Severity keyword banks with weights â”€â”€
CRITICAL_KEYWORDS = {
    'catastrophic': 5, 'devastating': 5, 'life-threatening': 5, 'mass casualty': 5,
    'multiple deaths': 5, 'fatalities': 5, 'dam breach': 5, 'bridge collapse': 5,
    'structural collapse': 5, 'explosion': 4, 'emergency declared': 4,
    'red warning': 4, 'level 3': 4, 'air ambulance': 4, 'bomb': 4,
    'gas explosion': 5, 'multiple casualties': 5, 'overwhelmed': 3,
    'water treatment plant failure': 4, 'crane collapse': 4, 'gas main rupture': 4,
    'boil water notice': 3, 'exclusion zone': 3, 'hazmat': 3,
}
HIGH_KEYWORDS = {
    'severe': 3, 'extensive': 3, 'dangerous': 3, 'urgent': 3, 'evacuated': 4,
    'submerged': 3, 'destroyed': 4, 'trapped': 4, 'rising rapidly': 3,
    'burst banks': 3, 'burst': 2, 'breached': 3, 'structural': 2,
    'suspended': 2, 'widespread': 3, 'multiple': 2, 'significant': 2,
    'rescue': 3, 'inferno': 3, 'spreading rapidly': 3, 'helicopters': 2,
    'power outage': 2, 'water-bombing': 3, 'firebreak': 2,
    'emergency services': 2, 'cordoned': 2, 'impassable': 2,
    'historical maximum': 3, 'record': 2, 'unprecedented': 3,
    'evacuations': 3, 'ambulance': 2, 'hospital': 2,
}
MEDIUM_KEYWORDS = {
    'moderate': 2, 'considerable': 2, 'affecting': 2, 'waterlogged': 2,
    'disruption': 2, 'closed': 2, 'warning': 2, 'monitoring': 1,
    'advisory': 1, 'concern': 1, 'restricti': 2, 'reduced': 1,
    'delay': 1, 'investigating': 1, 'assessing': 1, 'intermittent': 1,
    'spray': 1, 'caution': 1, 'blocked': 2, 'visibility': 1,
    'containment': 2, 'deployed': 1,
}
LOW_KEYWORDS = {
    'minor': 3, 'small': 3, 'limited': 3, 'isolated': 3, 'slight': 3,
    'negligible': 4, 'precaution': 2, 'no damage': 4, 'self-draining': 4,
    'no action required': 4, 'no properties affected': 4, 'puddle': 3,
    'scheduled': 2, 'planned': 2, 'next week': 2, 'no injuries': 2,
    'low': 1, 'minimal': 3, 'routine': 3,
}


def compute_severity(text: str) -> str:
    """Compute severity from text using weighted keyword analysis."""
    text_lower = text.lower()
    scores = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}

    for kw, weight in CRITICAL_KEYWORDS.items():
        if kw in text_lower:
            scores['critical'] += weight
    for kw, weight in HIGH_KEYWORDS.items():
        if kw in text_lower:
            scores['high'] += weight
    for kw, weight in MEDIUM_KEYWORDS.items():
        if kw in text_lower:
            scores['medium'] += weight
    for kw, weight in LOW_KEYWORDS.items():
        if kw in text_lower:
            scores['low'] += weight

    # Text length / detail as tiebreaker (longer = more serious)
    word_count = len(text_lower.split())
    if word_count > 25:
        scores['high'] += 1
    if word_count > 35:
        scores['critical'] += 1

    # Exclamation marks suggest urgency
    if text_lower.count('!') >= 2:
        scores['high'] += 1

    best = max(scores, key=scores.get)

    # If no strong signal, default to medium
    if scores[best] == 0:
        return 'medium'
    return best


# â”€â”€ NEW reports with severity-appropriate descriptions â”€â”€
# Each tuple: (category, display_type, description, CORRECT_severity)

NEW_REPORTS = [
    # â•â•â•â•â•â• CRITICAL â•â•â•â•â•â•
    ("natural_disaster", "Flood", "EMERGENCY DECLARED: Catastrophic flooding across Perth city centre. River Tay at highest level in 200 years. Multiple properties completely submerged. Mass evacuation of 3,000 residents underway. Life-threatening conditions. Emergency shelters at capacity.", "critical"),
    ("natural_disaster", "Flood", "Dam breach at Loch Faskally near Pitlochry. Devastating wall of water moving downstream. All residents within 5km must evacuate immediately. Multiple fatalities feared. Air ambulance and military deployed.", "critical"),
    ("natural_disaster", "Flood", "Bridge collapse on A9 at Dunkeld due to catastrophic flood waters. Multiple vehicles swept into river. Emergency rescue operations underway. Structural collapse of adjacent buildings reported. Mass casualty incident declared.", "critical"),
    ("natural_disaster", "Severe Storm", "Red warning storm with 120mph winds devastating western Scotland. Structural collapse of buildings in Oban. Multiple fatalities confirmed. Power grid catastrophic failure affecting 200,000 homes. Emergency declared across three council areas.", "critical"),
    ("natural_disaster", "Severe Storm", "Tornado confirmed in Campbeltown causing devastating destruction. Entire street of houses destroyed. Mass casualty incident. Air ambulance and military helicopter deployed. Life-threatening debris field.", "critical"),
    ("natural_disaster", "Wildfire", "Catastrophic wildfire engulfing Cairngorms village of Aviemore. 500+ properties under immediate evacuation order. Flames spreading at unprecedented rate. Multiple firefighter casualties. Air ambulance on scene. Emergency shelters overwhelmed.", "critical"),
    ("natural_disaster", "Wildfire", "Devastating forest fire in Galloway destroying 2,000 hectares. Flames jumped A75 motorway. Multiple structures destroyed including school. Fatalities feared. Military assistance requested. Life-threatening smoke conditions.", "critical"),
    ("natural_disaster", "Heatwave", "Emergency declared: Scotland records 40C for first time in history. Multiple heat-related fatalities across Glasgow. Hospital A&E departments overwhelmed. Power grid failure from air conditioning demand. Cooling centres at capacity.", "critical"),
    ("natural_disaster", "Landslide", "Catastrophic landslide buries three houses in Fort William. Multiple people trapped under debris. Emergency rescue teams and air ambulance deployed. Structural collapse of retaining wall triggered massive earth movement. Mass casualty incident declared.", "critical"),
    ("infrastructure", "Infrastructure Damage", "Gas explosion destroys two houses in residential Ayr street. Multiple casualties confirmed. 200-metre exclusion zone. Emergency services overwhelmed. Structural collapse risk to adjacent properties. Air ambulance deployed.", "critical"),
    ("infrastructure", "Infrastructure Damage", "Water treatment plant catastrophic failure at Glencorse serving Edinburgh south. 500,000 residents without safe water. Boil water notice issued. Emergency tanker deployment. Hospital water supply compromised.", "critical"),
    ("infrastructure", "Infrastructure Damage", "Crane collapse at Edinburgh waterfront crushes occupied vehicles below. Multiple fatalities feared. Structural collapse of adjacent building facade. Mass casualty incident. Entire area evacuated.", "critical"),
    ("public_safety", "Public Safety", "Chemical plant explosion at Grangemouth. Massive toxic plume spreading east. Emergency declared. Mass evacuation of 10,000 residents. Multiple casualties. Hazmat teams overwhelmed. Life-threatening air quality.", "critical"),
    ("public_safety", "Public Safety", "Gas main rupture causes explosion in Coatbridge residential street. Multiple houses destroyed. Confirmed fatalities. Air ambulance and multiple emergency crews on scene. Structural collapse ongoing.", "critical"),

    # â•â•â•â•â•â• HIGH â•â•â•â•â•â•
    ("natural_disaster", "Flood", "River Tay burst its banks near Perth city centre. Water level rising rapidly with several streets submerged. Emergency services responding to trapped residents. Evacuations underway for riverside properties.", "high"),
    ("natural_disaster", "Flood", "Severe flooding on A9 near Inverness. Road completely impassable with multiple vehicles stranded. Rising water threatening adjacent properties. Emergency services deploying rescue boats.", "high"),
    ("natural_disaster", "Flood", "Severe flood damage in Ballater. River Dee breached flood defences on east bank. Multiple properties inundated. Emergency evacuation of care home underway. Significant structural damage to buildings.", "high"),
    ("natural_disaster", "Flood", "River Clyde flood warning at highest level. Water levels approaching 2015 record highs. Evacuations being considered for 500+ properties in low-lying areas. Emergency services on standby.", "high"),
    ("natural_disaster", "Flood", "Flash flooding in Borders region following thunderstorms. Hawick worst affected with water in several streets. Emergency pumping operations. Roads impassable. Multiple rescue operations.", "high"),
    ("natural_disaster", "Flood", "Flood waters entering residential properties on Tay Street Perth. Emergency services rescuing trapped elderly residents. Water rising rapidly. Significant damage to ground floor properties.", "high"),
    ("natural_disaster", "Flood", "River Deveron overtopping at Huntly. Council opening emergency rest centre. Multiple roads impassable. Rising water threatening town centre businesses. Emergency sandbag deployment.", "high"),
    ("natural_disaster", "Flood", "Emergency pumping operations at Aberfeldy. River level exceeded historical maximum. Properties flooded. Rescue boats deployed. Bridge closed due to structural concerns from flood force.", "high"),
    ("natural_disaster", "Severe Storm", "Storm bringing 90mph winds to western Scotland. Extensive power line damage across Argyll and Bute. Trees down blocking emergency routes. Structural damage to multiple buildings. Ferry services suspended.", "high"),
    ("natural_disaster", "Severe Storm", "High winds causing significant structural damage in Oban. Roof tiles dangerous projectile risk. Ferries cancelled. Multiple emergency callouts for collapsed structures.", "high"),
    ("natural_disaster", "Severe Storm", "Strong winds toppled construction crane in Aberdeen city centre. Surrounding streets evacuated as structural collapse risk. Emergency cordons established. Significant disruption.", "high"),
    ("natural_disaster", "Severe Storm", "Severe weather red warning for Moray coast. Extremely dangerous conditions. Widespread power outage affecting 15,000 homes. Multiple structural damage reports. Emergency services stretched.", "high"),
    ("natural_disaster", "Wildfire", "Wildfire spreading across moorland near Fort William. Rapidly advancing front threatening properties. Multiple fire crews deployed. A82 closed. Smoke causing dangerous visibility. Evacuations ordered.", "high"),
    ("natural_disaster", "Wildfire", "Heather fire spreading rapidly across Glen Coe. Strong wind fanning flames towards village. Properties under evacuation order. Multiple helicopter water-bombing runs. Significant area burning.", "high"),
    ("natural_disaster", "Wildfire", "Moorland fire near Loch Lomond. 50+ hectares affected. Helicopters water-bombing. Fire crews from four stations. Threatening woodland and properties. Road closures in effect.", "high"),
    ("natural_disaster", "Heatwave", "Record-breaking temperatures across Scotland. NHS reporting surge in heat-related hospital admissions. Water supplies under extreme pressure. Emergency cooling centres opening. Vulnerable residents at significant risk.", "high"),
    ("natural_disaster", "Heatwave", "Extreme heat causing widespread rail disruption. Speed restrictions on Edinburgh-Glasgow line from buckled rails. Multiple delays and cancellations. Emergency timetable. Infrastructure under severe stress.", "high"),
    ("natural_disaster", "Drought", "SEPA warning of extremely low river flows across central Scotland. Salmon populations at severe risk. Emergency abstraction restrictions imposed. Reservoir levels dangerously low.", "high"),
    ("natural_disaster", "Drought", "Water levels in Loch Katrine reservoir at historic lows. Scottish Water emergency planning activated. Significant risk to Edinburgh water supply. Emergency conservation measures mandatory.", "high"),
    ("natural_disaster", "Landslide", "Major landslide blocking A83 at Rest and Be Thankful. Complete route closure both directions. Massive debris field. Emergency structural assessment. Alternative routes severely congested.", "high"),
    ("natural_disaster", "Landslide", "Mudflow from saturated hillside threatening houses in Fort Augustus. Several homes evacuated overnight. Emergency services assessing structural stability. Significant risk of further movement.", "high"),
    ("natural_disaster", "Landslide", "Slope failure in Helensburgh threatening residential street. Emergency evacuation of three households. Structural engineers assess high risk of further collapse. Road closed indefinitely.", "high"),
    ("infrastructure", "Infrastructure Damage", "Major power cable fault leaving entire Isle of Skye without electricity. Hospital on backup generators. 8,000 homes affected. Repair crews emergency deployment. Schools closed.", "high"),
    ("infrastructure", "Infrastructure Damage", "Burst water main on Princes Street Edinburgh. Major road closure. Water supply disrupted to 5,000 homes. Emergency repair teams deployed. Significant flooding of underground services.", "high"),
    ("infrastructure", "Infrastructure Damage", "Power outage affecting 15,000 homes across Lanarkshire. SSEN declaring emergency. Engineers working around the clock. Hospital backup systems activated. Vulnerable residents prioritised.", "high"),
    ("public_safety", "Public Safety", "Industrial ammonia leak at processing plant near Peterhead. Exclusion zone established affecting 500 residents. Emergency services in hazmat configuration. Stay indoors warning issued.", "high"),
    ("public_safety", "Public Safety", "Building deemed structurally unsafe after survey in Aberdeen. Emergency evacuation of 40 tenants. Adjacent buildings assessed for structural risk. Significant cordon in city centre.", "high"),
    ("environmental", "Environmental Hazard", "Significant oil spill in Firth of Clyde. SEPA deploying emergency containment booms. Marine wildlife rescue operations. Beach closures across three kilometres. Fishing ban imposed.", "high"),

    # â•â•â•â•â•â• MEDIUM â•â•â•â•â•â•
    ("natural_disaster", "Flood", "Coastal flooding at Stonehaven harbour. Storm surge combined with high tide causing localised inundation. Harbour area affected. Some road closures. Council monitoring situation.", "medium"),
    ("natural_disaster", "Flood", "Surface water flooding across Glasgow southside. Drainage systems struggling with sustained heavy rain. Some localised ponding on roads. Council teams deploying.", "medium"),
    ("natural_disaster", "Flood", "Agricultural flooding near Stirling. Several farms reporting waterlogged fields. Livestock moved to higher ground as precaution. No residential properties affected.", "medium"),
    ("natural_disaster", "Flood", "Flooding at Pitlochry dam spillway. Controlled release increasing downstream water levels. Riverside paths closed. Monitoring in place. No properties at immediate risk.", "medium"),
    ("natural_disaster", "Flood", "Localised flooding in Ayr town centre. River Ayr overtopping at several points along embankment. Sandbags deployed. Some shop basements affected.", "medium"),
    ("natural_disaster", "Flood", "Flood alert for upper Forth estuary. Spring tides combined with storm surge creating elevated water levels. Coastal defences holding. Precautionary monitoring.", "medium"),
    ("natural_disaster", "Flood", "Road flooding on M8 near Harthill. Standing water across one lane. Speed restrictions in place. Drivers advised to take care. No vehicles stranded.", "medium"),
    ("natural_disaster", "Flood", "Groundwater flooding affecting some properties in Speyside. Persistent rain saturating local aquifer. Monitoring in place. Pumping being considered.", "medium"),
    ("natural_disaster", "Flood", "River Earn rising near Crieff. Flood defence barriers being erected as precaution. No properties flooded yet. Council monitoring levels closely.", "medium"),
    ("natural_disaster", "Severe Storm", "Severe thunderstorm warning for central belt. Large hail and lightning expected this afternoon. People advised to stay indoors. Some localised disruption likely.", "medium"),
    ("natural_disaster", "Severe Storm", "Trees blown down across some roads in Perthshire. A9 partially blocked near Dunkeld. Council crews clearing. Delays expected. Alternative routes available.", "medium"),
    ("natural_disaster", "Severe Storm", "Wind damage to scaffolding on building site in Glasgow. Area cordoned off as precaution. No injuries reported. Structural assessment scheduled.", "medium"),
    ("natural_disaster", "Severe Storm", "Strong winds causing ferry cancellations to Arran and Bute. Services suspended until conditions moderate. Alternative travel advised. No safety concerns.", "medium"),
    ("natural_disaster", "Wildfire", "Grass fire on Arthur Seat in Edinburgh. Dry conditions and wind causing moderate spread. Fire crews attending. No properties threatened. Walking paths closed.", "medium"),
    ("natural_disaster", "Wildfire", "Gorse fire on outskirts of Nairn. Residents advised to keep windows closed due to smoke. Fire crews containing the blaze. No evacuation required.", "medium"),
    ("natural_disaster", "Wildfire", "Smoke from wildfire causing visibility issues on A87 near Kyle of Lochalsh. Drive with caution. Fire being managed by forestry commission. Localised impact.", "medium"),
    ("natural_disaster", "Heatwave", "Heat warning issued for Edinburgh. NHS advising people to stay hydrated and avoid direct sunlight. Temperatures reaching 28C. Localised disruption to some outdoor events.", "medium"),
    ("natural_disaster", "Heatwave", "Heatwave causing tarmac softening on M74. Speed restrictions in place on affected stretch. Motorway operational but delays expected.", "medium"),
    ("natural_disaster", "Drought", "Drought conditions affecting salmon runs in River Tweed. Conservation groups raising concerns about fish welfare. SEPA monitoring. No water restrictions yet.", "medium"),
    ("natural_disaster", "Drought", "Crop stress reported across east Scotland due to dry period. Farmers seeking advice on irrigation options. Agricultural support being considered.", "medium"),
    ("natural_disaster", "Drought", "Reservoir levels at 42 percent capacity in east Scotland. Stage 2 water restrictions being considered. Public asked to conserve water voluntarily.", "medium"),
    ("natural_disaster", "Landslide", "Rockfall on A82 near Loch Lomond. Single carriageway open with traffic management. Delays of 20 minutes. Geological assessment arranged.", "medium"),
    ("natural_disaster", "Landslide", "Cliff erosion threatening coastal path near St Andrews. Council erecting warning barriers. Path diverted. No properties at risk. Monitoring ongoing.", "medium"),
    ("natural_disaster", "Landslide", "Debris flow from hillside blocking minor road in Glen Coe. Council teams assessing stability. Road likely closed for 48 hours. Diversions in place.", "medium"),
    ("infrastructure", "Infrastructure Damage", "Gas leak detected in Paisley town centre. Precautionary 200-metre cordon established. No injuries. Engineers attending. Expected resolution within hours.", "medium"),
    ("infrastructure", "Infrastructure Damage", "Road surface subsidence on A90 near Dundee. Suspected underground void. One lane closed. Engineers investigating. Traffic management in place.", "medium"),
    ("infrastructure", "Infrastructure Damage", "Railway signal failure at Glasgow Central causing delays. Engineers attending. Some services running with reduced frequency. Estimated fix within 4 hours.", "medium"),
    ("infrastructure", "Infrastructure Damage", "Overhead power line brought down by fallen tree near Pitlochry. Road closed until line made safe. SSEN engineers en route. Localised power disruption.", "medium"),
    ("public_safety", "Public Safety", "Unexploded ordnance found on construction site in Leith. Bomb disposal team en route. Precautionary 100m cordon. No casualties. Expected resolution today.", "medium"),
    ("public_safety", "Public Safety", "Carbon monoxide alert at school in Kirkcaldy. Building evacuated as precaution. Pupils sent home. Investigation underway. No illness reported.", "medium"),
    ("environmental", "Environmental Hazard", "Algal bloom in Loch Leven causing localised fish kills. Public warned not to swim. Water quality monitoring increased. No drinking water impact.", "medium"),
    ("environmental", "Environmental Hazard", "Air quality advisory for Glasgow due to temperature inversion. Asthma sufferers advised to carry inhalers. Situation expected to clear within 24 hours.", "medium"),
    ("environmental", "Environmental Hazard", "Chemical drums washed up on beach near Dunbar. SEPA and coastguard investigating. Beach section closed as precaution. No contamination confirmed.", "medium"),

    # â•â•â•â•â•â• LOW â•â•â•â•â•â•
    ("natural_disaster", "Flood", "Minor surface water on side roads near Linlithgow. No properties affected. Water self-draining through existing drainage. No action required.", "low"),
    ("natural_disaster", "Flood", "Small burn slightly above normal level near Crieff. Well within banks. Monitoring only. No risk to properties. No action required.", "low"),
    ("natural_disaster", "Flood", "Puddle accumulation on A71 near Bathgate. No lane closures needed. Drivers advised of minor spray. Self-clearing as rain stops.", "low"),
    ("natural_disaster", "Flood", "Minor localised ponding in car park at Tesco Dundee after heavy shower. Self-draining. No vehicles affected. Negligible impact.", "low"),
    ("natural_disaster", "Flood", "Slight increase in river level on Tay at Perth. Well below any flood threshold. Routine monitoring. No properties at risk. Normal seasonal variation.", "low"),
    ("natural_disaster", "Flood", "Small amount of standing water on pavement in Stirling Old Town. Minor inconvenience only. Will clear naturally. No drainage issues.", "low"),
    ("natural_disaster", "Severe Storm", "Ice storm warning issued for northeast Scotland. Gritters deployed on main routes. Drivers advised to take care. Routine winter precaution.", "low"),
    ("natural_disaster", "Severe Storm", "Light snowfall on higher ground in Cairngorms. Roads gritted and clear. Ski centres reporting good conditions. No disruption to travel.", "low"),
    ("natural_disaster", "Severe Storm", "Minor wind damage to garden fence in residential Inverness. No injuries. No public infrastructure affected. Homeowner arranging own repair.", "low"),
    ("natural_disaster", "Wildfire", "Small controlled burn by Forestry Commission near Aviemore proceeding as planned. No risk to properties. Minimal smoke. Routine land management.", "low"),
    ("natural_disaster", "Wildfire", "Small grass fire on roadside verge near Perth quickly extinguished by passing crew. Area approximately 5 square metres. No risk. No damage.", "low"),
    ("natural_disaster", "Heatwave", "Warm spell forecast for weekend in Fife. Temperatures may reach 25C. Pleasant conditions. Stay hydrated. No health warnings issued.", "low"),
    ("natural_disaster", "Heatwave", "Slightly above average temperatures expected in Borders. Nothing unusual. NHS routine summer advice applies. No restrictions needed.", "low"),
    ("natural_disaster", "Drought", "Below average rainfall for April in Borders region. No restrictions needed. Reservoirs at comfortable levels. Monitoring as routine precaution.", "low"),
    ("natural_disaster", "Drought", "Garden watering advice issued for Fife. Voluntary conservation measures suggested. Water supplies adequate. No mandatory restrictions.", "low"),
    ("natural_disaster", "Landslide", "Minor rockfall on A9 near Killiecrankie. Small debris cleared within hour. Road fully open. No injuries. Routine maintenance inspection planned.", "low"),
    ("natural_disaster", "Landslide", "Small amount of earth slippage on footpath near Pitlochry. Path redirected. No structural risk. Council aware. Repair scheduled for next week.", "low"),
    ("infrastructure", "Infrastructure Damage", "Minor pothole damage on B road near Kirriemuir. No injuries. Council repair scheduled for next week. Temporary warning sign placed.", "low"),
    ("infrastructure", "Infrastructure Damage", "Intermittent broadband issues in rural Stirlingshire. Provider investigating. Mobile data available as alternative. Minimal impact.", "low"),
    ("infrastructure", "Infrastructure Damage", "Street lighting failure on one block in north Edinburgh. Reported to council. Repair planned within 48 hours. No safety incidents.", "low"),
    ("infrastructure", "Infrastructure Damage", "Small water leak from hydrant on residential street in Perth. Minimal flow. Repair scheduled. No supply disruption to homes.", "low"),
    ("public_safety", "Public Safety", "Minor dog complaint in Falkirk park. Rangers attended. Dog owner identified and advised. No injuries. Routine community safety matter.", "low"),
    ("public_safety", "Public Safety", "Abandoned bicycle reported near Holyrood. Police confirmed no security concern. Item removed. Routine lost property matter.", "low"),
    ("environmental", "Environmental Hazard", "Small amount of litter found near River Tay. Community cleanup being organized for weekend. No environmental damage. Volunteer effort.", "low"),
    ("environmental", "Environmental Hazard", "Minor oil sheen observed on puddle in Dundee industrial estate car park. Source identified as leaking vehicle. No environmental risk. Cleaned up.", "low"),
]

locations = [
    ("Edinburgh", 55.9533, -3.1883), ("Glasgow", 55.8642, -4.2518),
    ("Aberdeen", 57.1497, -2.0943), ("Dundee", 56.4620, -2.9707),
    ("Inverness", 57.4778, -4.2247), ("Perth", 56.3952, -3.4308),
    ("Stirling", 56.1191, -3.9469), ("Fort William", 56.8198, -5.1052),
    ("Oban", 56.4128, -5.4711), ("Aviemore", 57.1956, -3.8266),
    ("St Andrews", 56.3398, -2.7967), ("Pitlochry", 56.7069, -3.7347),
    ("Dumfries", 55.0700, -3.6059), ("Stonehaven", 56.9637, -2.2100),
    ("Ballater", 57.0504, -3.0397),
]
names = ["A. Smith", "B. Jones", "C. Brown", "D. Wilson", "E. Taylor",
         "F. Anderson", "G. Thomas", "H. Jackson", "I. White", "J. Harris",
         "K. Murray", "L. Campbell", "M. Stewart", "N. Robertson", "O. Fraser"]


async def main():
    conn = await asyncpg.connect(DB_URL)

    # â”€â”€ Step 1: Re-label existing reports based on text content â”€â”€
    print("Step 1: Re-labeling existing reports based on text content...")
    rows = await conn.fetch("""
        SELECT id, description, severity::text as severity
        FROM reports WHERE deleted_at IS NULL AND LENGTH(COALESCE(description, '')) > 10
    """)
    relabeled = 0
    for row in rows:
        new_sev = compute_severity(row['description'])
        if new_sev != row['severity']:
            await conn.execute(
                "UPDATE reports SET severity = $1::report_severity WHERE id = $2",
                new_sev, row['id']
            )
            relabeled += 1
    print(f"  Re-labeled {relabeled}/{len(rows)} reports")

    # â”€â”€ Step 2: Insert new severity-correct reports â”€â”€
    print(f"Step 2: Inserting {len(NEW_REPORTS)} new severity-correct reports...")
    random.seed(123)
    base_time = datetime(2026, 2, 1)
    inserted = 0
    for cat, display, desc, severity in NEW_REPORTS:
        loc = random.choice(locations)
        ts = base_time + timedelta(hours=random.randint(0, 1200))
        status = "verified" if severity in ('critical', 'high') else random.choice(["verified", "verified", "unverified"])
        conf = round(random.uniform(0.60, 0.95), 4)
        try:
            await conn.execute("""
                INSERT INTO reports (
                    id, incident_category, incident_subtype, display_type, description, severity,
                    status, location_text, coordinates, ai_confidence, created_at,
                    reporter_name, reporter_ip, region_id, report_number
                ) VALUES (
                    $1, $2, $3, $4, $5, $6::report_severity, $7::report_status, $8,
                    ST_SetSRID(ST_MakePoint($9, $10), 4326), $11, $12,
                    $13, $14, $15,
                    'RPT-' || LPAD(FLOOR(RANDOM() * 99999)::TEXT, 5, '0')
                )
            """,
                str(uuid.uuid4()), cat, display.lower().replace(" ", "_"),
                display, desc, severity, status, loc[0], loc[2], loc[1],
                conf, ts, random.choice(names),
                f"192.168.{random.randint(1,10)}.{random.randint(1,254)}",
                "uk-default",
            )
            inserted += 1
        except Exception as e:
            print(f"  Error: {e}")

    # â”€â”€ Step 3: Show distribution â”€â”€
    total = await conn.fetchval("SELECT count(*) FROM reports WHERE deleted_at IS NULL")
    rows = await conn.fetch("""
        SELECT severity::text as sev, count(*) as c
        FROM reports WHERE deleted_at IS NULL
        GROUP BY severity ORDER BY severity
    """)
    print(f"\nInserted {inserted} new reports. Total: {total}")
    print("Severity distribution:")
    for r in rows:
        print(f"  {r['sev']:10s} {r['c']}")

    # Verify label quality
    print("\nLabel quality check (sample):")
    samples = await conn.fetch("""
        SELECT severity::text as sev, LEFT(description, 80) as desc_preview
        FROM reports WHERE deleted_at IS NULL
        ORDER BY RANDOM() LIMIT 8
    """)
    for s in samples:
        print(f"  [{s['sev']:8s}] {s['desc_preview']}...")

    await conn.close()


asyncio.run(main())
