-- AEGIS Seed Data
-- Populates the database with realistic sample data for testing
-- and demonstration during the degree show presentation
-- Includes: 30 sample reports across Scotland,
-- AI model metrics for the transparency dashboard, and sample alerts

-- Sample reports across Scottish cities
-- Each report simulates a realistic emergency scenario
-- Coordinates use WGS84 (EPSG:4326) for PostGIS compatibility

-- Aberdeen area reports
INSERT INTO reports (report_number, incident_category, incident_subtype, display_type, description, severity, status, trapped_persons, location_text, coordinates, ai_confidence, ai_analysis) VALUES
('RPT-001', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Don has overflowed at Park Bridge. Water level approximately 1.5 metres above normal. Multiple vehicles stranded on Don Street. Water entering ground floor properties along Grandholm Drive.', 'high', 'verified', 'property', 'Park Bridge, River Don, Aberdeen', ST_SetSRID(ST_MakePoint(-2.0948, 57.1720), 4326), 92, '{"panicLevel": 7, "fakeProbability": 5, "sentimentScore": -0.8, "keyEntities": ["River Don", "Park Bridge", "Grandholm Drive"], "reasoning": "High confidence: matches SEPA high-risk zone, consistent with current river levels, multiple verifiable landmarks mentioned."}'),

('RPT-002', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Surface water flooding on King Street near university. Drains overwhelmed by heavy rainfall. Water about 30cm deep across the road. Buses diverted.', 'medium', 'verified', 'no', 'King Street, Aberdeen City Centre', ST_SetSRID(ST_MakePoint(-2.0965, 57.1498), 4326), 85, '{"panicLevel": 4, "fakeProbability": 8, "sentimentScore": -0.4, "keyEntities": ["King Street", "university"], "reasoning": "Moderate confidence: plausible surface water scenario, low panic language."}'),

('RPT-003', 'infrastructure', 'road_damage', 'Infrastructure — Road Damage / Closure', 'Large sinkhole appeared on Anderson Drive near the Bridge of Dee junction. Road completely impassable. Emergency services on scene. Traffic diversions in place.', 'high', 'urgent', 'no', 'Anderson Drive, Aberdeen', ST_SetSRID(ST_MakePoint(-2.1148, 57.1265), 4326), 88, '{"panicLevel": 5, "fakeProbability": 10, "sentimentScore": -0.6, "keyEntities": ["Anderson Drive", "Bridge of Dee"], "reasoning": "High confidence: infrastructure damage consistent with weather patterns."}'),

('RPT-004', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Dee rising rapidly at Cults. Water approaching Riverside Drive properties. Sandbags deployed but water still advancing. Several families preparing to evacuate.', 'high', 'verified', 'no', 'Riverside Drive, Cults, Aberdeen', ST_SetSRID(ST_MakePoint(-2.1550, 57.1340), 4326), 90, '{"panicLevel": 6, "fakeProbability": 7, "sentimentScore": -0.7, "keyEntities": ["River Dee", "Cults", "Riverside Drive"], "reasoning": "High confidence: known flood-prone area, evacuation language consistent with genuine emergency."}'),

('RPT-005', 'natural_disaster', 'storm', 'Natural Disaster — Storm / Hurricane', 'Severe wind damage on Beach Boulevard. Several shop signs torn off. Debris scattered across the road. Power lines down near the beach esplanade. Stay away from the area.', 'high', 'unverified', 'no', 'Beach Boulevard, Aberdeen', ST_SetSRID(ST_MakePoint(-2.0640, 57.1540), 4326), 72, '{"panicLevel": 6, "fakeProbability": 15, "sentimentScore": -0.5, "keyEntities": ["Beach Boulevard", "esplanade"], "reasoning": "Moderate confidence: storm damage plausible but power line claim needs verification."}'),

-- Edinburgh area reports
('RPT-006', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Water of Leith overflowing at Dean Village. Footpath submerged. Water rising towards buildings on Bell''s Brae. Heritage properties at risk.', 'high', 'verified', 'no', 'Dean Village, Edinburgh', ST_SetSRID(ST_MakePoint(-3.2190, 55.9520), 4326), 91, '{"panicLevel": 6, "fakeProbability": 6, "sentimentScore": -0.7, "keyEntities": ["Water of Leith", "Dean Village", "Bell''s Brae"], "reasoning": "High confidence: known flooding hotspot, detailed location references."}'),

('RPT-007', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Serious flooding at Roseburn area. Murrayfield ice rink car park completely underwater. Water flowing down residential streets. Multiple basements flooding.', 'high', 'urgent', 'property', 'Roseburn, Edinburgh', ST_SetSRID(ST_MakePoint(-3.2400, 55.9460), 4326), 87, '{"panicLevel": 7, "fakeProbability": 8, "sentimentScore": -0.8, "keyEntities": ["Roseburn", "Murrayfield", "basements"], "reasoning": "High confidence: Roseburn is a documented flood-risk area along Water of Leith."}'),

('RPT-008', 'infrastructure', 'power_outage', 'Infrastructure — Power Outage', 'Power outage affecting entire Stockbridge area. Traffic lights out on Queensferry Road. Shops closing due to no electricity. Been without power for 2 hours now.', 'medium', 'verified', 'no', 'Stockbridge, Edinburgh', ST_SetSRID(ST_MakePoint(-3.2100, 55.9580), 4326), 80, '{"panicLevel": 3, "fakeProbability": 12, "sentimentScore": -0.3, "keyEntities": ["Stockbridge", "Queensferry Road"], "reasoning": "Moderate confidence: power outage claim reasonable, may follow flood/storm damage."}'),

('RPT-009', 'community_safety', 'shelter_needed', 'Community Safety — Shelter Needed', 'Family of five displaced from flooded flat on Leith Walk. Young children, one infant. Need temporary shelter and dry clothing urgently. Currently in a doorway.', 'high', 'urgent', 'yes', 'Leith Walk, Edinburgh', ST_SetSRID(ST_MakePoint(-3.1720, 55.9640), 4326), 78, '{"panicLevel": 8, "fakeProbability": 15, "sentimentScore": -0.9, "keyEntities": ["Leith Walk", "family", "children", "infant"], "reasoning": "Medium-high confidence: vulnerable persons reported, needs immediate verification."}'),

-- Glasgow area reports
('RPT-010', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Clyde levels dangerously high at Dalmarnock. Clyde Gateway area flooded. Water across London Road. Industrial units along Fordneuk Street submerged.', 'high', 'verified', 'no', 'Dalmarnock, Glasgow', ST_SetSRID(ST_MakePoint(-4.2050, 55.8450), 4326), 93, '{"panicLevel": 7, "fakeProbability": 5, "sentimentScore": -0.8, "keyEntities": ["River Clyde", "Dalmarnock", "London Road", "Fordneuk Street"], "reasoning": "Very high confidence: known Clyde flood risk area, specific street references verify local knowledge."}'),

('RPT-011', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'White Cart Water flooding Cathcart area severely. Holmlea Road impassable. Cars floating at the Linn Park entrance. Evacuation of elderly care home on Clarkston Road underway.', 'high', 'urgent', 'yes', 'Cathcart, Glasgow', ST_SetSRID(ST_MakePoint(-4.2700, 55.8220), 4326), 95, '{"panicLevel": 9, "fakeProbability": 4, "sentimentScore": -0.9, "keyEntities": ["White Cart Water", "Cathcart", "Holmlea Road", "Linn Park", "elderly care home"], "reasoning": "Very high confidence: White Cart is major flood risk, elderly evacuation requires immediate response."}'),

('RPT-012', 'infrastructure', 'building_collapse', 'Infrastructure — Building Collapse', 'Partial wall collapse on old tenement on Maryhill Road. Scaffolding and bricks on pavement. Road closed by police. Building was already in poor condition, heavy rain worsened it.', 'high', 'verified', 'no', 'Maryhill Road, Glasgow', ST_SetSRID(ST_MakePoint(-4.2770, 55.8850), 4326), 82, '{"panicLevel": 6, "fakeProbability": 12, "sentimentScore": -0.6, "keyEntities": ["Maryhill Road", "tenement", "collapse"], "reasoning": "Moderate-high confidence: building collapse plausible with heavy rainfall and aging infrastructure."}'),

('RPT-013', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Kelvin overflowing at Kelvinbridge. Footbridge impassable. Water in the gardens below Great Western Road. Joggers and dog walkers trapped on wrong side.', 'medium', 'verified', 'no', 'Kelvinbridge, Glasgow', ST_SetSRID(ST_MakePoint(-4.2820, 55.8760), 4326), 86, '{"panicLevel": 5, "fakeProbability": 9, "sentimentScore": -0.5, "keyEntities": ["River Kelvin", "Kelvinbridge", "Great Western Road"], "reasoning": "High confidence: Kelvin regularly floods, detailed local landmarks confirm genuine report."}'),

-- Dundee area reports
('RPT-014', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Tay estuary surge flooding Riverside Drive near V&A museum. Waterfront promenade completely submerged. Strong currents making it dangerous. Tourist area evacuated.', 'high', 'verified', 'no', 'Riverside Drive, Dundee', ST_SetSRID(ST_MakePoint(-2.9670, 56.4575), 4326), 89, '{"panicLevel": 6, "fakeProbability": 7, "sentimentScore": -0.7, "keyEntities": ["Tay", "V&A", "Riverside Drive", "waterfront"], "reasoning": "High confidence: coastal flooding of Tay documented, V&A area is low-lying."}'),

('RPT-015', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Dighty Water flooding Whitfield area. Playing fields completely underwater. Water approaching Lothian Crescent housing. Residents very concerned.', 'medium', 'unverified', 'no', 'Whitfield, Dundee', ST_SetSRID(ST_MakePoint(-2.9200, 56.4800), 4326), 74, '{"panicLevel": 5, "fakeProbability": 18, "sentimentScore": -0.5, "keyEntities": ["Dighty Water", "Whitfield", "Lothian Crescent"], "reasoning": "Moderate confidence: Dighty floods occasionally, but language is vague."}'),

('RPT-016', 'infrastructure', 'road_damage', 'Infrastructure — Road Damage / Closure', 'Landslip on A90 approach to Dundee from Perth. Single lane only. Major delays. Hillside eroded by persistent rain. Potential for further movement.', 'medium', 'verified', 'no', 'A90, Dundee', ST_SetSRID(ST_MakePoint(-3.0500, 56.4600), 4326), 83, '{"panicLevel": 3, "fakeProbability": 10, "sentimentScore": -0.3, "keyEntities": ["A90", "Perth", "landslip"], "reasoning": "Moderate-high confidence: A90 landslips are known issue in wet weather."}'),

-- Inverness
('RPT-017', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Ness flooding at Huntly Street in city centre. Water in shops. Multiple sandbag barriers breached. Fire service pumping water from basements.', 'high', 'urgent', 'property', 'Huntly Street, Inverness', ST_SetSRID(ST_MakePoint(-4.2290, 57.4790), 4326), 90, '{"panicLevel": 8, "fakeProbability": 6, "sentimentScore": -0.8, "keyEntities": ["River Ness", "Huntly Street", "fire service"], "reasoning": "High confidence: River Ness floods documented, emergency services mentioned."}'),

-- Perth
('RPT-018', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Tay extremely high at Perth. North Inch parkland flooded. Bell''s Sports Centre car park underwater. Tay Street road surface covered in standing water.', 'high', 'verified', 'no', 'North Inch, Perth', ST_SetSRID(ST_MakePoint(-3.4380, 56.4020), 4326), 91, '{"panicLevel": 6, "fakeProbability": 6, "sentimentScore": -0.6, "keyEntities": ["River Tay", "North Inch", "Bell''s Sports Centre", "Tay Street"], "reasoning": "High confidence: Perth Tay flooding is well-documented, specific landmarks verify local knowledge."}'),

-- Stirling
('RPT-019', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Forth flooding agricultural land near Stirling. Approach roads to Cambuskenneth impassable. Water level still rising according to local farmer.', 'medium', 'verified', 'no', 'Cambuskenneth, Stirling', ST_SetSRID(ST_MakePoint(-3.9230, 56.1220), 4326), 84, '{"panicLevel": 4, "fakeProbability": 10, "sentimentScore": -0.4, "keyEntities": ["River Forth", "Cambuskenneth", "agricultural"], "reasoning": "Moderate-high confidence: Forth floodplain regularly floods, credible source (farmer)."}'),

-- Additional Aberdeen
('RPT-020', 'public_safety', 'traffic_accident', 'Public Safety — Major Traffic Accident', 'Multi-vehicle collision on A96 near Dyce due to surface water. At least 4 vehicles involved. Road completely blocked. Ambulance and fire engines on scene.', 'high', 'verified', 'yes', 'A96, Dyce, Aberdeen', ST_SetSRID(ST_MakePoint(-2.1680, 57.2020), 4326), 79, '{"panicLevel": 7, "fakeProbability": 14, "sentimentScore": -0.7, "keyEntities": ["A96", "Dyce", "ambulance", "fire"], "reasoning": "Moderate confidence: plausible weather-related accident, emergency services mentioned."}'),

('RPT-021', 'environmental', 'water_contamination', 'Environmental — Water Contamination', 'Floodwater has mixed with sewage at Torry. Strong smell reported by multiple residents on Victoria Road. Health risk especially for children. Council aware but no action yet.', 'medium', 'flagged', 'no', 'Torry, Aberdeen', ST_SetSRID(ST_MakePoint(-2.0820, 57.1380), 4326), 76, '{"panicLevel": 5, "fakeProbability": 16, "sentimentScore": -0.6, "keyEntities": ["Torry", "Victoria Road", "sewage", "health risk"], "reasoning": "Moderate confidence: sewage contamination common with flooding, but unverified."}'),

('RPT-022', 'community_safety', 'vulnerable_person', 'Community Safety — Vulnerable Person at Risk', 'Elderly neighbour (90+) on Urquhart Road refusing to evacuate despite rising water. Lives alone on ground floor. Water is at her front step. She is confused and frightened.', 'high', 'urgent', 'yes', 'Urquhart Road, Aberdeen', ST_SetSRID(ST_MakePoint(-2.0920, 57.1560), 4326), 70, '{"panicLevel": 8, "fakeProbability": 20, "sentimentScore": -0.9, "keyEntities": ["Urquhart Road", "elderly", "ground floor"], "reasoning": "Moderate confidence: vulnerable person report needs immediate welfare check regardless."}'),

-- More Edinburgh
('RPT-023', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Cramond River overflowing near Cramond village. Boardwalk to island submerged. Several walkers stranded near Cramond Island as causeway flooded by both river and tide.', 'high', 'urgent', 'yes', 'Cramond, Edinburgh', ST_SetSRID(ST_MakePoint(-3.2960, 55.9770), 4326), 87, '{"panicLevel": 8, "fakeProbability": 8, "sentimentScore": -0.8, "keyEntities": ["Cramond", "Cramond Island", "causeway", "tide"], "reasoning": "High confidence: Cramond Island stranding is a known risk, consistent with tidal + river flooding."}'),

('RPT-024', 'infrastructure', 'water_main', 'Infrastructure — Water Main Break', 'Major water main burst on Gorgie Road near the Hearts stadium. Road completely flooded. Huge spray of water 3 metres high. Water pressure lost in surrounding streets.', 'medium', 'verified', 'no', 'Gorgie Road, Edinburgh', ST_SetSRID(ST_MakePoint(-3.2380, 55.9380), 4326), 81, '{"panicLevel": 4, "fakeProbability": 12, "sentimentScore": -0.4, "keyEntities": ["Gorgie Road", "Hearts stadium", "water main"], "reasoning": "Moderate-high confidence: infrastructure failure, specific landmarks verify location."}'),

-- More Glasgow
('RPT-025', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Severe flooding at Yoker along the Clyde. Multiple ground-floor flats evacuated on Dumbarton Road. Elderly residents being assisted by neighbours. Water knee-deep in places.', 'high', 'verified', 'yes', 'Yoker, Glasgow', ST_SetSRID(ST_MakePoint(-4.3800, 55.8820), 4326), 88, '{"panicLevel": 7, "fakeProbability": 7, "sentimentScore": -0.8, "keyEntities": ["Yoker", "Clyde", "Dumbarton Road", "elderly"], "reasoning": "High confidence: Yoker is a known Clyde flood-risk area, detailed and consistent report."}'),

('RPT-026', 'medical', 'ambulance_needed', 'Medical Emergency — Ambulance Required', 'Person collapsed in floodwater at Glasgow Green near the People''s Palace. Bystanders pulled them out. Conscious but hypothermic. No ambulance available, all deployed elsewhere.', 'high', 'urgent', 'yes', 'Glasgow Green, Glasgow', ST_SetSRID(ST_MakePoint(-4.2250, 55.8480), 4326), 73, '{"panicLevel": 9, "fakeProbability": 15, "sentimentScore": -0.9, "keyEntities": ["Glasgow Green", "People''s Palace", "hypothermic", "ambulance"], "reasoning": "Moderate confidence: medical emergency in flood context, needs immediate response."}'),

-- Highlands
('RPT-027', 'natural_disaster', 'landslide', 'Natural Disaster — Landslide / Mudslide', 'Landslide blocking A82 at Loch Lomond near Tarbet. Large rocks and debris on road. Completely impassable in both directions. Estimated 50+ vehicles stuck.', 'high', 'verified', 'no', 'A82, Tarbet, Loch Lomond', ST_SetSRID(ST_MakePoint(-4.7200, 56.2000), 4326), 86, '{"panicLevel": 5, "fakeProbability": 9, "sentimentScore": -0.5, "keyEntities": ["A82", "Loch Lomond", "Tarbet", "landslide"], "reasoning": "High confidence: A82 landslides at this location are well-documented."}'),

('RPT-028', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Spey flooding at Aviemore. Grampian Road shops sandbagging. Caravan park near Dell Road evacuated. River still rising according to SEPA gauge.', 'high', 'verified', 'no', 'Aviemore, Highlands', ST_SetSRID(ST_MakePoint(-3.8260, 57.1940), 4326), 89, '{"panicLevel": 5, "fakeProbability": 7, "sentimentScore": -0.6, "keyEntities": ["River Spey", "Aviemore", "Grampian Road", "SEPA"], "reasoning": "High confidence: River Spey flooding is common, SEPA gauge reference adds credibility."}'),

-- Borders
('RPT-029', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'River Tweed flooding at Peebles. Extensive flooding along Tweed Green. Footbridge closed. Several campervan park visitors stranded. Water levels continuing to rise overnight.', 'medium', 'unverified', 'no', 'Peebles, Scottish Borders', ST_SetSRID(ST_MakePoint(-3.1900, 55.6510), 4326), 77, '{"panicLevel": 5, "fakeProbability": 14, "sentimentScore": -0.5, "keyEntities": ["River Tweed", "Peebles", "Tweed Green"], "reasoning": "Moderate confidence: Tweed flooding is realistic, but time reference (overnight) makes verification difficult."}'),

-- Fife
('RPT-030', 'natural_disaster', 'flood', 'Natural Disaster — Flood / Rising Water', 'Coastal flooding in St Andrews. Heavy seas overtopping the harbour wall. East Scores and The Scores areas affected. University buildings sandbagging entrances.', 'medium', 'verified', 'no', 'St Andrews, Fife', ST_SetSRID(ST_MakePoint(-2.7970, 56.3400), 4326), 84, '{"panicLevel": 4, "fakeProbability": 10, "sentimentScore": -0.4, "keyEntities": ["St Andrews", "harbour", "The Scores", "university"], "reasoning": "Moderate-high confidence: coastal flooding at St Andrews is documented, multiple landmarks verify local knowledge."}')
ON CONFLICT (report_number) DO NOTHING;

-- Sample alerts
-- Guard against duplicate inserts on re-run (alerts have no natural unique key).
-- Only insert if the alerts table is empty (seed data scenario).
INSERT INTO alerts (title, message, severity, alert_type, location_text, coordinates, radius_km)
SELECT v.* FROM (VALUES
  ('Flood Warning — River Don, Aberdeen'::VARCHAR(200), 'SEPA has issued a flood warning for the River Don at Park Bridge. River levels are expected to peak overnight. Residents in low-lying areas of Bridge of Don and Grandholm should prepare for potential evacuation.'::TEXT, 'critical'::alert_severity, 'flood_warning'::VARCHAR(50), 'River Don, Aberdeen'::VARCHAR(200), ST_SetSRID(ST_MakePoint(-2.095, 57.172), 4326), 5.0::FLOAT),
  ('Flood Alert — River Dee, Aberdeenshire', 'River Dee levels are rising. Properties along Riverside Drive in Cults should prepare sandbag defences. Monitor SEPA for updates.', 'warning', 'flood_warning', 'River Dee, Aberdeen', ST_SetSRID(ST_MakePoint(-2.155, 57.134), 4326), 8.0),
  ('Surface Water Warning — Edinburgh', 'Heavy rainfall forecast for Edinburgh over the next 12 hours. Risk of surface water flooding in Dean Village, Roseburn, and Stockbridge areas. Avoid low-lying routes.', 'warning', 'flood_warning', 'Edinburgh', ST_SetSRID(ST_MakePoint(-3.220, 55.952), 4326), 15.0),
  ('Flood Warning — River Clyde, Glasgow', 'River Clyde expected to reach warning levels by evening. Dalmarnock, Yoker, and Glasgow Green areas at greatest risk. Emergency shelters open at Tollcross Leisure Centre.', 'critical', 'flood_warning', 'River Clyde, Glasgow', ST_SetSRID(ST_MakePoint(-4.250, 55.860), 4326), 12.0),
  ('Travel Disruption — A82 Loch Lomond', 'A82 blocked at Tarbet due to landslide. No estimated reopening time. Use A83/M80 as alternative route. Avoid unnecessary travel in the area.', 'warning', 'travel', 'A82, Loch Lomond', ST_SetSRID(ST_MakePoint(-4.720, 56.200), 4326), 20.0)
) AS v(title, message, severity, alert_type, location_text, coordinates, radius_km)
WHERE NOT EXISTS (SELECT 1 FROM alerts LIMIT 1);

-- AI model performance metrics
-- Pre-populated for the transparency dashboard
-- In production, these would be updated after each model training cycle
-- Only insert if the table is empty (idempotent on re-run)
INSERT INTO ai_model_metrics (model_name, model_version, accuracy, precision_score, recall, f1_score, confusion_matrix, feature_importance, confidence_distribution, training_samples, last_trained, notes)
SELECT * FROM (VALUES
('FloodClassifier'::VARCHAR(100), 'v1.2'::VARCHAR(20), 0.89::FLOAT, 0.91::FLOAT, 0.87::FLOAT, 0.87::FLOAT,
 '{"labels": ["River", "Flash", "Coastal", "Surface"], "matrix": [[40, 5, 2, 3], [4, 38, 1, 7], [1, 2, 42, 5], [3, 6, 4, 37]]}'::JSONB,
 '{"features": [{"name": "River level (m)", "importance": 0.35}, {"name": "Rainfall 24h (mm)", "importance": 0.28}, {"name": "Elevation (m)", "importance": 0.18}, {"name": "Soil saturation (%)", "importance": 0.08}, {"name": "Distance to river (m)", "importance": 0.06}, {"name": "Historical frequency", "importance": 0.03}, {"name": "Season", "importance": 0.02}]}'::JSONB,
 '{"ranges": [{"label": "90-100%", "count": 45}, {"label": "80-89%", "count": 62}, {"label": "70-79%", "count": 38}, {"label": "60-69%", "count": 25}, {"label": "50-59%", "count": 18}, {"label": "<50%", "count": 12}]}'::JSONB,
 2847::INTEGER, '2026-02-12 14:30:00+00'::TIMESTAMPTZ, 'Trained on SEPA historical flood records 2000-2025 combined with Environment Agency data. LSTM component uses 10-year river level time series.'::TEXT),

('SentimentAnalyser', 'v2.0', 0.93, 0.92, 0.94, 0.93,
 '{"labels": ["Panic", "Urgent", "Calm", "Informational"], "matrix": [[85, 8, 2, 5], [6, 82, 4, 8], [1, 3, 90, 6], [3, 5, 4, 88]]}',
 '{"features": [{"name": "Exclamation density", "importance": 0.22}, {"name": "Urgency keywords", "importance": 0.20}, {"name": "Caps ratio", "importance": 0.15}, {"name": "Negation count", "importance": 0.12}, {"name": "Named entities", "importance": 0.10}, {"name": "Sentence length", "importance": 0.08}, {"name": "Verb tense", "importance": 0.07}, {"name": "Specificity score", "importance": 0.06}]}',
 '{"ranges": [{"label": "90-100%", "count": 120}, {"label": "80-89%", "count": 85}, {"label": "70-79%", "count": 42}, {"label": "60-69%", "count": 28}, {"label": "50-59%", "count": 15}, {"label": "<50%", "count": 10}]}',
 5200, '2026-02-15 09:00:00+00', 'Fine-tuned on CrisisNLP dataset plus 1200 manually annotated Scottish emergency reports.'),

('FakeReportDetector', 'v1.0', 0.86, 0.88, 0.84, 0.86,
 '{"labels": ["Genuine", "Suspicious", "Fake"], "matrix": [[78, 12, 10], [8, 72, 20], [5, 15, 80]]}',
 '{"features": [{"name": "Location specificity", "importance": 0.30}, {"name": "Temporal consistency", "importance": 0.22}, {"name": "Cross-reference match", "importance": 0.18}, {"name": "Language authenticity", "importance": 0.12}, {"name": "Media verification", "importance": 0.10}, {"name": "Reporter history", "importance": 0.08}]}',
 '{"ranges": [{"label": "90-100%", "count": 30}, {"label": "80-89%", "count": 55}, {"label": "70-79%", "count": 48}, {"label": "60-69%", "count": 35}, {"label": "50-59%", "count": 22}, {"label": "<50%", "count": 10}]}',
 3150, '2026-02-10 16:45:00+00', 'Trained on mix of genuine SEPA-verified reports and synthetically generated fake reports. Cross-references against SEPA flood zone polygons and river gauge data.')
) AS v(model_name, model_version, accuracy, precision_score, recall, f1_score, confusion_matrix, feature_importance, confidence_distribution, training_samples, last_trained, notes)
WHERE NOT EXISTS (SELECT 1 FROM ai_model_metrics LIMIT 1);

-- Community help offers (seed data)
-- Only insert if the table is empty (no unique constraint to conflict on)
INSERT INTO community_help (type, category, title, description, location_text, location_lat, location_lng, capacity, status, consent_given)
SELECT v.* FROM (VALUES
  ('offer'::community_help_type, 'shelter'::community_help_category, 'Aberdeen Community Centre'::TEXT, 'Heated space with beds for 30 people. Hot drinks available.'::TEXT, 'Union Street, Aberdeen'::TEXT, 57.1497::DOUBLE PRECISION, -2.0943::DOUBLE PRECISION, 30::INTEGER, 'active'::community_help_status, true::BOOLEAN),
  ('offer', 'food', 'Torry Volunteer Kitchen', 'Hot meals served 12pm-8pm. Bottled water available.', 'Victoria Road, Torry', 57.1350, -2.0780, 50, 'active', true),
  ('offer', 'transport', 'Bridge of Don 4x4 Group', '3 vehicles available for evacuation. Can carry 12 people.', 'Bridge of Don, Aberdeen', 57.1780, -2.0920, 12, 'active', true),
  ('offer', 'medical', 'St Johns First Aiders', 'Qualified first aiders with supplies. Available 24/7.', 'King Street, Aberdeen', 57.1540, -2.0850, 5, 'active', true),
  ('offer', 'clothing', 'Salvation Army Depot', 'Dry clothing, blankets, and hygiene kits.', 'George Street, Aberdeen', 57.1510, -2.0950, 100, 'active', true),
  ('request', 'shelter', 'Family of 4 needs accommodation', '2 adults and 2 children displaced by flooding. Pets: 1 cat.', 'Cults, Aberdeen', 57.1200, -2.1500, 4, 'active', true),
  ('request', 'food', 'Elderly residents need meals', '8 elderly residents in care home, kitchen flooded.', 'Dyce, Aberdeen', 57.2050, -2.1650, 8, 'active', true)
) AS v(type, category, title, description, location_text, location_lat, location_lng, capacity, status, consent_given)
WHERE NOT EXISTS (SELECT 1 FROM community_help LIMIT 1);

-- Seed data for flood_predictions
-- Only insert if the table is empty (no unique constraint to conflict on)
INSERT INTO flood_predictions (area, probability, time_to_flood, matched_pattern, next_areas, severity, confidence, data_sources, model_version)
SELECT v.* FROM (VALUES
('River Don Area'::VARCHAR(200), 0.87::FLOAT, '45 mins'::VARCHAR(100), 'Feb 2023 Flood (87% similarity)'::VARCHAR(300), ARRAY['King Street', 'Market Square']::TEXT[], 'high'::report_severity, 87::INTEGER, ARRAY['River gauge', 'Rainfall radar', 'Historical pattern', 'Citizen reports']::TEXT[], 'flood-fp-v2.1'::VARCHAR(50)),
('Dee Valley', 0.62, '2 hours', 'Nov 2022 Flood (62% similarity)', ARRAY['Bridge of Dee', 'Garthdee Road'], 'medium', 62, ARRAY['River gauge', 'Historical pattern'], 'flood-fp-v2.1'),
('Coastal Aberdeen', 0.45, '4 hours', 'Storm Babet 2023 (45% similarity)', ARRAY['Beach Esplanade', 'Footdee'], 'low', 45, ARRAY['Tide gauge', 'Wind forecast', 'Historical pattern'], 'flood-fp-v2.1')
) AS v(area, probability, time_to_flood, matched_pattern, next_areas, severity, confidence, data_sources, model_version)
WHERE NOT EXISTS (SELECT 1 FROM flood_predictions LIMIT 1);

-- resource_deployments: no seed data — zones are created by operators via the
-- Resources console when a real incident requires deployment.
-- The table starts empty. Use POST /api/deployments to create zones programmatically.

--  SEED: Activity Log entries (matching Screenshot 3 style)
--  Only insert if audit_log is empty (idempotent on re-run)
INSERT INTO audit_log (operator_name, action, action_type, target_type, created_at)
SELECT * FROM (VALUES
  ('System Administrator'::VARCHAR(100), 'Exported reports as CSV'::TEXT, 'export'::VARCHAR(50), 'report'::VARCHAR(50), NOW()),
  ('System Administrator', 'Logged in to AEGIS Admin', 'login', 'session', NOW() - INTERVAL '1 hour'),
  ('System Administrator', 'Verified report', 'verify', 'report', NOW() - INTERVAL '1 hour'),
  ('System Administrator', 'Sent alert: Flood Warning — River Don', 'alert_send', 'alert', NOW() - INTERVAL '55 minutes'),
  ('Emergency Operator', 'Flagged report for review', 'flag', 'report', NOW() - INTERVAL '45 minutes'),
  ('System Administrator', 'Deployed resources to Bridge of Don', 'deploy', 'deployment', NOW() - INTERVAL '35 minutes'),
  ('Emergency Operator', 'Escalated to URGENT', 'urgent', 'report', NOW() - INTERVAL '25 minutes')
) AS v(operator_name, action, action_type, target_type, created_at)
WHERE NOT EXISTS (SELECT 1 FROM audit_log LIMIT 1);

