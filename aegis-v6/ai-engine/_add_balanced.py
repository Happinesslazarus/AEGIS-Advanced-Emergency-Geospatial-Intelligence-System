"""
Module: _add_balanced.py

_add_balanced AI engine module.
"""

import os
"""Add more critical and low severity reports to balance the dataset."""
import asyncio, asyncpg, random, uuid
from datetime import datetime, timedelta

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

CRITICAL_REPORTS = [
    ("natural_disaster", "Flood", "CATASTROPHIC flooding destroys entire village of Braemar. Bridge collapse cuts off 2,000 residents. Multiple fatalities confirmed. Air ambulance and military deployed. Life-threatening conditions persist. Emergency shelters overwhelmed."),
    ("natural_disaster", "Flood", "Devastating flood surge overwhelms Glasgow Clydeside defences. Mass evacuation of 5,000 residents from riverside flats. Structural collapse of historic warehouse. Multiple casualties reported. Emergency declared."),
    ("natural_disaster", "Flood", "Dam breach warning at Loch Morar. Catastrophic failure imminent. Immediate evacuation order for all downstream communities. Life-threatening wall of water expected. Mass casualty preparations underway."),
    ("natural_disaster", "Flood", "Unprecedented flash flood destroys Hawick town centre. Multiple people trapped in collapsed buildings. Emergency rescue operations with air ambulance. Bridge structural collapse confirmed. Fatalities feared."),
    ("natural_disaster", "Severe Storm", "Category red storm devastates Orkney. Structural collapse of community centre with 50 people inside. Multiple casualties. Emergency declared. All rescue services deployed. Life-threatening conditions."),
    ("natural_disaster", "Severe Storm", "Catastrophic tornado strikes Falkirk industrial area. Gas main rupture causes explosion. Multiple fatalities. Devastating destruction across half-mile path. Mass casualty incident. Air ambulance deployed."),
    ("natural_disaster", "Severe Storm", "Unprecedented blizzard traps 200 vehicles on A9 Highland. Multiple casualties from hypothermia. Military rescue operation. Emergency shelters overwhelmed. Life-threatening conditions for 48 hours."),
    ("natural_disaster", "Wildfire", "Devastating wildfire destroys village of Tomintoul. 300 properties destroyed. Multiple fatalities confirmed. Entire population evacuated. Air ambulance and military helicopters deployed. Catastrophic environmental damage."),
    ("natural_disaster", "Wildfire", "Catastrophic forest fire in Trossachs completely out of control. 5,000 hectares burning. Multiple firefighter casualties. Emergency declared across three regions. Life-threatening smoke conditions."),
    ("natural_disaster", "Heatwave", "Mass casualty heat event in Glasgow. 15 fatalities confirmed. Hospital emergency departments overwhelmed. Emergency declared. Catastrophic strain on emergency services. Cooling centres at capacity."),
    ("natural_disaster", "Heatwave", "Unprecedented 42C temperature collapses power grid across central Scotland. Multiple heat fatalities. Life-threatening conditions for vulnerable. Hospital emergency generators failing. Emergency declared."),
    ("natural_disaster", "Landslide", "Catastrophic landslide buries row of houses in Oban. Multiple people trapped. Structural collapse ongoing. Air ambulance and mountain rescue deployed. Mass casualty incident declared. Life-threatening."),
    ("natural_disaster", "Landslide", "Devastating mudslide engulfs school in Fort William. Emergency rescue of trapped children. Multiple casualties. Structural collapse of gymnasium. Air ambulance. Mass casualty incident."),
    ("natural_disaster", "Drought", "Catastrophic water supply failure across Edinburgh. Reservoir empty. Emergency declared. 500,000 without water. Mass tanker deployment. Hospital water supply critical. Life-threatening for vulnerable."),
    ("infrastructure", "Infrastructure Damage", "Catastrophic gas explosion levels three houses in Paisley. Multiple confirmed fatalities. Structural collapse of adjacent buildings. Mass evacuation. Air ambulance. Emergency declared across Renfrewshire."),
    ("infrastructure", "Infrastructure Damage", "Major bridge structural collapse on Forth Road Bridge. Multiple vehicles fallen. Mass casualty incident declared. All emergency services deployed. Life-threatening rescue operations ongoing."),
    ("infrastructure", "Infrastructure Damage", "Catastrophic dam failure at hydroelectric plant near Pitlochry. Devastating flood surge downstream. Emergency evacuation of 3,000 people. Multiple fatalities feared. Military deployed."),
    ("infrastructure", "Infrastructure Damage", "Power station explosion near Longannet. Catastrophic failure of grid. 200,000 homes without power. Multiple casualties at plant. Emergency declared. Hospital generators critical."),
    ("public_safety", "Public Safety", "Devastating explosion at chemical storage facility Grangemouth. Multiple fatalities. Toxic plume forcing mass evacuation of 15,000. Catastrophic environmental contamination. Life-threatening air quality."),
    ("public_safety", "Public Safety", "Structural collapse of multi-storey car park in Dundee with occupied vehicles. Multiple casualties confirmed. Emergency rescue from crushed levels. Mass casualty incident. Air ambulance deployed."),
    ("environmental", "Environmental Hazard", "Catastrophic toxic waste spill into River Clyde. Mass fish kill along 20km stretch. Emergency declared. Drinking water supply contaminated for 100,000 residents. Life-threatening contamination levels."),
    ("environmental", "Environmental Hazard", "Devastating industrial chemical leak at Mossmorran. Toxic cloud spreading. Mass evacuation ordered. Multiple casualties from exposure. Emergency declared. Life-threatening conditions for surrounding communities."),
]

LOW_REPORTS = [
    ("natural_disaster", "Flood", "Tiny amount of standing water on footpath after rain in Dundee park. No drainage issues. Will clear naturally within hour. Negligible impact. No action needed."),
    ("natural_disaster", "Flood", "Slight dampness on basement wall of shop in Perth after rain. No water ingress. Routine maintenance matter. No emergency response needed. Minor cosmetic issue."),
    ("natural_disaster", "Flood", "Very minor puddle on residential driveway in Edinburgh suburbs. Self-draining. No property risk whatsoever. Normal after rainfall. No action required."),
    ("natural_disaster", "Flood", "Small seasonal burn running slightly higher than usual near Aviemore. Well within normal range. No properties nearby. Routine natural variation. No concern."),
    ("natural_disaster", "Flood", "Minor splash from gutter overflow at single property in Glasgow. Homeowner clearing leaves from drain. No emergency. Routine maintenance. Negligible."),
    ("natural_disaster", "Flood", "Slight increase in water level at ornamental pond in Stirling park after rain. Normal drainage functioning. No risk. No action required."),
    ("natural_disaster", "Severe Storm", "Light breeze with minor branch fall in garden in Aberdeen. No damage to property. Homeowner tidying up. No emergency response needed. Routine autumn weather."),
    ("natural_disaster", "Severe Storm", "Light dusting of snow on Cairngorm summit. Roads clear at lower levels. Ski centres reporting thin cover. Normal winter weather. No disruption."),
    ("natural_disaster", "Severe Storm", "Small plastic recycling bin blown over by wind in residential Inverness street. No damage. No obstruction. Resident righted it. Negligible incident."),
    ("natural_disaster", "Severe Storm", "Light frost on windscreens in Edinburgh morning. Normal seasonal occurrence. Roads treated by gritters overnight. No disruption. No action required."),
    ("natural_disaster", "Wildfire", "Tiny patch of dry grass scorched by discarded cigarette near Glasgow park. Approximately 1 square metre. Self-extinguished. No risk. No damage."),
    ("natural_disaster", "Wildfire", "Small planned bonfire at farm near Perth conducted safely with landowner permission. No risk to surrounding area. Routine agricultural practice."),
    ("natural_disaster", "Wildfire", "Minor smoke smell from neighbour's garden bonfire in Dundee suburb. Legal and within permitted hours. No emergency. No environmental concern."),
    ("natural_disaster", "Heatwave", "Pleasant 22C day in St Andrews. Normal summer temperature. No health concerns. Ideal conditions for outdoor activities. No advisory needed."),
    ("natural_disaster", "Heatwave", "Slightly warm afternoon in Stirling. Temperature 24C. Within normal range. No health warnings. Routine summer weather. Enjoy responsibly."),
    ("natural_disaster", "Drought", "Slightly below average rainfall this month in Aberdeenshire. Within normal variation. Reservoirs at 85% capacity. No restrictions. No concern."),
    ("natural_disaster", "Drought", "Dry week in Fife with no rainfall. Normal for time of year. Garden centres advising routine watering. No mandatory restrictions. No emergency."),
    ("natural_disaster", "Drought", "River Dee flows slightly below seasonal average. Within normal bounds. SEPA monitoring routinely. No restrictions required. Fish populations unaffected."),
    ("natural_disaster", "Landslide", "A few small pebbles on footpath near Glencoe after rain. Path fully usable. No risk. Routine clearing by next maintenance visit. Negligible."),
    ("natural_disaster", "Landslide", "Minor soil creep on garden slope in Helensburgh. No structural risk. Homeowner planning routine landscaping. No emergency response needed. Cosmetic issue."),
    ("infrastructure", "Infrastructure Damage", "Single street light flickering on quiet residential street in Perth. Reported to council. Repair scheduled. No safety concern. Alternative lighting adequate."),
    ("infrastructure", "Infrastructure Damage", "Small crack in pavement on side street in Dundee. No trip hazard. Council aware. Routine repair scheduled for next month. Minimal inconvenience."),
    ("infrastructure", "Infrastructure Damage", "Slow dripping tap at public toilet in Stirling park. Maintenance ticket raised. Washer replacement needed. Minimal water waste. Routine repair."),
    ("infrastructure", "Infrastructure Damage", "Faded road markings on quiet B road near Pitlochry. Refresh scheduled for summer. No safety concern at current traffic levels. Routine maintenance."),
    ("public_safety", "Public Safety", "Lost cat reported in residential Inverness street. Not an emergency. Owner has posted notices. Community helping search. No public safety concern."),
    ("public_safety", "Public Safety", "Noise complaint about music at garden party in Edinburgh suburb. Within permitted hours. Police not attending. Routine community matter. No safety issue."),
    ("environmental", "Environmental Hazard", "Single plastic bag spotted in River Forth near Alloa. Negligible environmental impact. Litter picker scheduled for area. No contamination risk whatsoever."),
    ("environmental", "Environmental Hazard", "Slight earthy smell near compost facility in rural Angus. Normal operational odour. Within licence limits. No complaints from nearest residents. Routine."),
    ("natural_disaster", "Flood", "Garden sprinkler accidentally left on overnight in Edinburgh suburb causing small wet patch on lawn. No flooding. Owner turned it off. Not an emergency."),
    ("natural_disaster", "Flood", "Rain collecting in old plant pot in Glasgow garden. Homeowner tipped it out. No drainage issue. No property risk. Completely negligible. No action needed."),
]

locations = [
    ("Edinburgh", 55.9533, -3.1883), ("Glasgow", 55.8642, -4.2518),
    ("Aberdeen", 57.1497, -2.0943), ("Dundee", 56.4620, -2.9707),
    ("Inverness", 57.4778, -4.2247), ("Perth", 56.3952, -3.4308),
    ("Stirling", 56.1191, -3.9469), ("Fort William", 56.8198, -5.1052),
    ("Oban", 56.4128, -5.4711), ("Aviemore", 57.1956, -3.8266),
]
names = ["A. Smith", "B. Jones", "C. Brown", "D. Wilson", "E. Taylor",
         "F. Anderson", "G. Thomas", "H. Jackson", "I. White", "J. Harris"]


async def main():
    conn = await asyncpg.connect(DB_URL)
    random.seed(456)
    base_time = datetime(2026, 1, 15)
    inserted = 0

    for desc in [r for r in CRITICAL_REPORTS]:
        cat, display, text = desc
        loc = random.choice(locations)
        ts = base_time + timedelta(hours=random.randint(0, 1500))
        try:
            await conn.execute("""
                INSERT INTO reports (id, incident_category, incident_subtype, display_type, description,
                    severity, status, location_text, coordinates, ai_confidence, created_at,
                    reporter_name, reporter_ip, region_id, report_number)
                VALUES ($1,$2,$3,$4,$5,'critical'::report_severity,'verified'::report_status,$6,
                    ST_SetSRID(ST_MakePoint($7,$8),4326),$9,$10,$11,$12,$13,
                    'RPT-'||LPAD(FLOOR(RANDOM()*99999)::TEXT,5,'0'))
            """, str(uuid.uuid4()), cat, display.lower().replace(" ", "_"), display, text,
                loc[0], loc[2], loc[1], round(random.uniform(0.7, 0.95), 4), ts,
                random.choice(names), f"192.168.{random.randint(1,10)}.{random.randint(1,254)}", "uk-default")
            inserted += 1
        except Exception as e:
            print(f"Error: {e}")

    for desc in [r for r in LOW_REPORTS]:
        cat, display, text = desc[0], desc[1], desc[2]
        loc = random.choice(locations)
        ts = base_time + timedelta(hours=random.randint(0, 1500))
        try:
            await conn.execute("""
                INSERT INTO reports (id, incident_category, incident_subtype, display_type, description,
                    severity, status, location_text, coordinates, ai_confidence, created_at,
                    reporter_name, reporter_ip, region_id, report_number)
                VALUES ($1,$2,$3,$4,$5,'low'::report_severity,'verified'::report_status,$6,
                    ST_SetSRID(ST_MakePoint($7,$8),4326),$9,$10,$11,$12,$13,
                    'RPT-'||LPAD(FLOOR(RANDOM()*99999)::TEXT,5,'0'))
            """, str(uuid.uuid4()), cat, display.lower().replace(" ", "_"), display, text,
                loc[0], loc[2], loc[1], round(random.uniform(0.5, 0.85), 4), ts,
                random.choice(names), f"192.168.{random.randint(1,10)}.{random.randint(1,254)}", "uk-default")
            inserted += 1
        except Exception as e:
            print(f"Error: {e}")

    total = await conn.fetchval("SELECT count(*) FROM reports WHERE deleted_at IS NULL")
    rows = await conn.fetch("SELECT severity::text as s, count(*) as c FROM reports WHERE deleted_at IS NULL GROUP BY severity ORDER BY severity")
    print(f"Inserted {inserted}. Total: {total}")
    for r in rows:
        print(f"  {r['s']:10s} {r['c']}")
    await conn.close()

asyncio.run(main())
