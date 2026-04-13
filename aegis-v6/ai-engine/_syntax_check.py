"""
Module: _syntax_check.py

_syntax_check AI engine module.
"""

import ast, pathlib, sys

files = [
    'app/hazards/flood.py',
    'app/hazards/drought.py',
    'app/hazards/heatwave.py',
    'app/hazards/severe_storm.py',
    'app/hazards/wildfire.py',
    'app/hazards/landslide.py',
    'app/hazards/power_outage.py',
    'app/hazards/water_supply_disruption.py',
    'app/hazards/infrastructure_damage.py',
    'app/hazards/public_safety_incident.py',
    'app/hazards/environmental_hazard.py',
    'app/hazards/shap_explainer.py',
    'app/training/region_config.py',
    'app/training/data_fetch_open_meteo.py',
    'app/training/base_hazard_pipeline.py',
    'app/training/validate_models.py',
    'app/core/model_registry.py',
    'app/schemas/predictions.py',
]

errors = 0
for f in files:
    try:
        source = pathlib.Path(f).read_text(encoding='utf-8')
        ast.parse(source)
        print(f'OK  {f}')
    except SyntaxError as e:
        print(f'FAIL {f}: line {e.lineno}: {e.msg}')
        errors += 1

print(f'\nChecked {len(files)} files, {errors} errors')
sys.exit(errors)
