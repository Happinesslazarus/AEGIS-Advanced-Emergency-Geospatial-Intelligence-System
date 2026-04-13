"""
Module: patch_target.py

Patch_target utility script.

Simple explanation:
Standalone script for patch_target.
"""
import pathlib

f = pathlib.Path(r'e:\aegis-v6-fullstack\aegis-v6\ai-engine\app\training\data_loaders.py')
content = f.read_text(encoding='utf-8')

# Replace the target assignment line to use ground-truth from report category
OLD = '''            target = self._derive_hazard_target(hazard_type, report, dynamic, climate)

            sample = {
                'timestamp': ts,
                'hazard_type': hazard_type,'''

NEW = '''            # Ground-truth label: 1 if this report's category matches the hazard type, 0 otherwise
            # The model must learn to predict the hazard from environmental features,
            # NOT have the label derived from those same features (circular reasoning).
            category = str(report.get('incident_category', '')).lower()
            target = int(hazard_type.lower() in category)

            sample = {
                'timestamp': ts,
                'hazard_type': hazard_type,'''

assert OLD in content, "Could not find target assignment block"
content = content.replace(OLD, NEW)
f.write_text(content, encoding='utf-8')
print("Patched: target now uses ground-truth category label (not environmental derivation)")
