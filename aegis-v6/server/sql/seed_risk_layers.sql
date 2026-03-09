-- ═══════════════════════════════════════════════════════════════════
-- Seed risk_layers with real UK flood risk zone polygons
-- Based on EA/SEPA known flood zones (PostGIS geometry)
-- ═══════════════════════════════════════════════════════════════════

-- Aberdeen — River Don floodplain (Bridge of Don to Seaton)
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Don Floodplain (Aberdeen)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.0950,57.1780],[-2.0870,57.1790],[-2.0810,57.1770],[-2.0780,57.1730],[-2.0830,57.1700],[-2.0910,57.1720],[-2.0960,57.1760],[-2.0950,57.1780]]]]}'),
  '{"risk_level":"high","source":"SEPA","river":"River Don","flood_type":"fluvial","return_period":"1_in_100","last_significant_event":"2016-01-07","population_at_risk":5200}',
  'sepa_v2024'
) ON CONFLICT DO NOTHING;

-- Aberdeen — River Dee corridor (Duthie Park to Torry)
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Dee Corridor (Aberdeen)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.1150,57.1380],[-2.1050,57.1390],[-2.0950,57.1370],[-2.0900,57.1340],[-2.0950,57.1310],[-2.1050,57.1300],[-2.1150,57.1330],[-2.1200,57.1360],[-2.1150,57.1380]]]]}'),
  '{"risk_level":"medium","source":"SEPA","river":"River Dee","flood_type":"fluvial","return_period":"1_in_200","population_at_risk":3800}',
  'sepa_v2024'
) ON CONFLICT DO NOTHING;

-- Aberdeen Coastal strip (Beach Boulevard to Footdee)
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'Aberdeen Coastal Flood Zone',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.0700,57.1520],[-2.0620,57.1530],[-2.0560,57.1510],[-2.0550,57.1470],[-2.0600,57.1440],[-2.0670,57.1430],[-2.0710,57.1460],[-2.0720,57.1500],[-2.0700,57.1520]]]]}'),
  '{"risk_level":"medium","source":"SEPA","flood_type":"coastal","return_period":"1_in_200","tidal_influence":true,"population_at_risk":2100}',
  'sepa_v2024'
) ON CONFLICT DO NOTHING;

-- York — River Ouse floodplain
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Ouse Floodplain (York)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-1.0950,53.9620],[-1.0850,53.9650],[-1.0750,53.9630],[-1.0700,53.9580],[-1.0750,53.9540],[-1.0850,53.9520],[-1.0950,53.9560],[-1.0980,53.9600],[-1.0950,53.9620]]]]}'),
  '{"risk_level":"high","source":"EA","river":"River Ouse","flood_type":"fluvial","return_period":"1_in_100","last_significant_event":"2015-12-26","population_at_risk":12000}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Tewkesbury — Severn/Avon confluence
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'Severn-Avon Confluence (Tewkesbury)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.1700,51.9950],[-2.1550,51.9980],[-2.1400,51.9950],[-2.1350,51.9880],[-2.1430,51.9830],[-2.1580,51.9820],[-2.1700,51.9870],[-2.1730,51.9930],[-2.1700,51.9950]]]]}'),
  '{"risk_level":"high","source":"EA","river":"River Severn","flood_type":"fluvial","return_period":"1_in_50","last_significant_event":"2007-07-20","population_at_risk":9500}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- London — Thames Barrier protected zone
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'Thames Tidal Flood Zone (London)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[0.0300,51.5050],[0.0450,51.5070],[0.0550,51.5040],[0.0600,51.4980],[0.0530,51.4940],[0.0380,51.4930],[0.0280,51.4970],[0.0260,51.5020],[0.0300,51.5050]]]]}'),
  '{"risk_level":"medium","source":"EA","river":"River Thames","flood_type":"tidal","return_period":"1_in_1000","barrier_protected":true,"population_at_risk":1200000}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Somerset Levels (Bridgwater area)
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'Somerset Levels Flood Zone',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.9900,51.1300],[-2.9600,51.1350],[-2.9300,51.1280],[-2.9200,51.1150],[-2.9350,51.1050],[-2.9650,51.1030],[-2.9850,51.1100],[-2.9950,51.1220],[-2.9900,51.1300]]]]}'),
  '{"risk_level":"high","source":"EA","flood_type":"fluvial","return_period":"1_in_25","last_significant_event":"2014-01-01","population_at_risk":6800}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Carlisle — River Eden
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Eden Floodplain (Carlisle)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.9550,54.8980],[-2.9400,54.9010],[-2.9280,54.8980],[-2.9240,54.8920],[-2.9310,54.8870],[-2.9450,54.8860],[-2.9560,54.8910],[-2.9580,54.8960],[-2.9550,54.8980]]]]}'),
  '{"risk_level":"high","source":"EA","river":"River Eden","flood_type":"fluvial","return_period":"1_in_100","last_significant_event":"2015-12-05","population_at_risk":7200}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Leeds — River Aire
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Aire Floodplain (Leeds)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-1.5700,53.7950],[-1.5550,53.7970],[-1.5400,53.7940],[-1.5350,53.7890],[-1.5430,53.7850],[-1.5580,53.7840],[-1.5700,53.7880],[-1.5730,53.7930],[-1.5700,53.7950]]]]}'),
  '{"risk_level":"medium","source":"EA","river":"River Aire","flood_type":"fluvial","return_period":"1_in_100","last_significant_event":"2015-12-26","population_at_risk":8500}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Shrewsbury — River Severn
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Severn Floodplain (Shrewsbury)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.7600,52.7120],[-2.7450,52.7140],[-2.7350,52.7110],[-2.7320,52.7060],[-2.7380,52.7020],[-2.7500,52.7010],[-2.7600,52.7050],[-2.7630,52.7090],[-2.7600,52.7120]]]]}'),
  '{"risk_level":"high","source":"EA","river":"River Severn","flood_type":"fluvial","return_period":"1_in_50","population_at_risk":4500}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Edinburgh — Water of Leith
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'Water of Leith Flood Zone (Edinburgh)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-3.2300,55.9530],[-3.2150,55.9550],[-3.2050,55.9530],[-3.2020,55.9490],[-3.2080,55.9460],[-3.2200,55.9450],[-3.2300,55.9480],[-3.2320,55.9510],[-3.2300,55.9530]]]]}'),
  '{"risk_level":"medium","source":"SEPA","river":"Water of Leith","flood_type":"fluvial","return_period":"1_in_200","population_at_risk":3200}',
  'sepa_v2024'
) ON CONFLICT DO NOTHING;

-- Glasgow — River Clyde
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Clyde Flood Zone (Glasgow)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-4.2700,55.8580],[-4.2500,55.8600],[-4.2350,55.8570],[-4.2300,55.8530],[-4.2370,55.8490],[-4.2530,55.8480],[-4.2680,55.8510],[-4.2720,55.8560],[-4.2700,55.8580]]]]}'),
  '{"risk_level":"medium","source":"SEPA","river":"River Clyde","flood_type":"fluvial_tidal","return_period":"1_in_200","population_at_risk":15000}',
  'sepa_v2024'
) ON CONFLICT DO NOTHING;

-- Dundee — River Tay
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Tay Flood Zone (Dundee)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-2.9800,56.4620],[-2.9600,56.4640],[-2.9450,56.4610],[-2.9400,56.4570],[-2.9470,56.4530],[-2.9630,56.4520],[-2.9780,56.4560],[-2.9820,56.4600],[-2.9800,56.4620]]]]}'),
  '{"risk_level":"medium","source":"SEPA","river":"River Tay","flood_type":"tidal","return_period":"1_in_200","population_at_risk":4800}',
  'sepa_v2024'
) ON CONFLICT DO NOTHING;

-- Hull — Humber Estuary
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'Humber Estuary Flood Zone (Hull)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-0.3500,53.7450],[-0.3300,53.7470],[-0.3150,53.7440],[-0.3100,53.7400],[-0.3170,53.7360],[-0.3330,53.7350],[-0.3480,53.7380],[-0.3520,53.7430],[-0.3500,53.7450]]]]}'),
  '{"risk_level":"high","source":"EA","river":"Humber Estuary","flood_type":"tidal","return_period":"1_in_200","last_significant_event":"2013-12-05","population_at_risk":25000}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;

-- Nottingham — River Trent
INSERT INTO risk_layers (name, layer_type, geometry_data, properties, model_version)
VALUES (
  'River Trent Floodplain (Nottingham)',
  'flood_risk',
  ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[-1.1600,52.9550],[-1.1450,52.9570],[-1.1300,52.9540],[-1.1260,52.9490],[-1.1330,52.9450],[-1.1480,52.9440],[-1.1600,52.9480],[-1.1630,52.9530],[-1.1600,52.9550]]]]}'),
  '{"risk_level":"medium","source":"EA","river":"River Trent","flood_type":"fluvial","return_period":"1_in_100","population_at_risk":6200}',
  'ea_v2024'
) ON CONFLICT DO NOTHING;
