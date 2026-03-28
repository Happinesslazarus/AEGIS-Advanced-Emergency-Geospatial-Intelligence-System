"""Fix engineer_all_features to check for station_id before river features."""
filepath = r"E:\aegis-v6-fullstack\aegis-v6\ai-engine\app\training\feature_engineering.py"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old = '''        # River features (flood-specific)
        if hazard_type == "flood" and "river_level" in result.columns:
            river_out = FeatureEngineer.compute_river_features(result)'''

new = '''        # River features (flood-specific, requires station_id)
        if hazard_type == "flood" and "river_level" in result.columns and "station_id" in result.columns:
            river_out = FeatureEngineer.compute_river_features(result)'''

if old in content:
    content = content.replace(old, new)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Patched feature_engineering.py")
else:
    print("ERROR: Old text not found")
