"""Patch the seed_training_data.py file to fix schema issues."""
import re

f = r'e:\aegis-v6-fullstack\aegis-v6\server\scripts\seed_training_data.py'
t = open(f, 'r', encoding='utf-8').read()

# 1. Remove incident_type from reports INSERT column list
t = t.replace(
    'ai_confidence, ai_analysis, region_id, incident_type, created_at',
    'ai_confidence, ai_analysis, region_id, created_at'
)

# 2. Remove %(incident_type)s from VALUES
t = t.replace(
    '%(ai_analysis)s::jsonb, %(region_id)s, %(incident_type)s, %(created_at)s',
    '%(ai_analysis)s::jsonb, %(region_id)s, %(created_at)s'
)

# 3. Add hazard_type to fusion dict if not present
if '"hazard_type"' not in t:
    t = t.replace(
        '"region_id": r["id"],  # Link to report\n            "water_level_input"',
        '"region_id": r["id"],\n            "hazard_type": r["incident_category"] if r["incident_category"] in ("flood", "storm", "drought", "heatwave", "wildfire") else "flood",\n            "water_level_input"'
    )

# 4. Add model_version and computation_time_ms to fusion dict if not present
if '"model_version"' not in t:
    t = t.replace(
        '}),\n            "created_at": r["created_at"],\n        })',
        '}),\n            "model_version": "fusion-v2.1",\n            "computation_time_ms": random.randint(15, 350),\n            "created_at": r["created_at"],\n        })'
    )

# 5. Fix fusion INSERT SQL - add hazard_type, model_version, computation_time_ms
old_fc_cols = 'id, region_id, water_level_input, rainfall_input, gauge_delta_input,'
new_fc_cols = 'id, region_id, hazard_type, water_level_input, rainfall_input, gauge_delta_input,'
t = t.replace(old_fc_cols, new_fc_cols)

old_fc_vals_start = '%(id)s, %(region_id)s, %(water_level_input)s::jsonb'
new_fc_vals_start = '%(id)s, %(region_id)s, %(hazard_type)s, %(water_level_input)s::jsonb'
t = t.replace(old_fc_vals_start, new_fc_vals_start)

old_fc_cols2 = 'fused_probability, fused_confidence, feature_weights, created_at'
new_fc_cols2 = 'fused_probability, fused_confidence, feature_weights,\n                model_version, computation_time_ms, created_at'
t = t.replace(old_fc_cols2, new_fc_cols2)

old_fc_vals2 = '%(fused_probability)s, %(fused_confidence)s, %(feature_weights)s::jsonb, %(created_at)s'
new_fc_vals2 = '%(fused_probability)s, %(fused_confidence)s, %(feature_weights)s::jsonb,\n                %(model_version)s, %(computation_time_ms)s, %(created_at)s'
t = t.replace(old_fc_vals2, new_fc_vals2)

# 6. Remove the CREATE TABLE IF NOT EXISTS fusion_computations (table already exists)
create_fc_pattern = r'        # Check if fusion_computations table exists\n.*?conn\.commit\(\)\n\s*\n'
t = re.sub(create_fc_pattern, '', t, flags=re.DOTALL)

open(f, 'w', encoding='utf-8').write(t)

# Verify
content = open(f, 'r', encoding='utf-8').read()
checks = {
    'incident_type removed from INSERT': 'incident_type' not in content.split('INSERT INTO reports')[1].split('ON CONFLICT')[0] if 'INSERT INTO reports' in content else False,
    'hazard_type in fusion dict': '"hazard_type"' in content,
    'model_version in fusion dict': '"model_version"' in content,
    'hazard_type in fusion SQL': 'hazard_type' in content.split('INSERT INTO fusion')[1].split('ON CONFLICT')[0] if 'INSERT INTO fusion' in content else False,
    'model_version in fusion SQL': 'model_version' in content.split('INSERT INTO fusion')[1].split('ON CONFLICT')[0] if 'INSERT INTO fusion' in content else False,
}
for k, v in checks.items():
    print(f"  {'OK' if v else 'FAIL'}: {k}")
