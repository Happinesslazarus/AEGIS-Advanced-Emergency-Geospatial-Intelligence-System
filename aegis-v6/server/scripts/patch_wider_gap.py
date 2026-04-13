"""
Module: patch_wider_gap.py

Patch_wider_gap utility script.

Simple explanation:
Standalone script for patch_wider_gap.
"""
import os

FILE = r'e:\aegis-v6-fullstack\aegis-v6\ai-engine\app\training\data_loaders.py'

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

if content.startswith('\ufeff'):
    content = content[1:]

# Patch flood thresholds
OLD_FLOOD = """        if hz == 'flood':
            if is_positive:
                # Flood events: select high-rainfall observations (top 25%)
                rain_threshold = nearby['rainfall_mm'].quantile(0.75)
                filtered = nearby[nearby['rainfall_mm'] >= rain_threshold]
            else:
                # Non-flood: select low/normal rainfall (bottom 60%)
                rain_threshold = nearby['rainfall_mm'].quantile(0.60)
                filtered = nearby[nearby['rainfall_mm'] <= rain_threshold]"""

NEW_FLOOD = """        if hz == 'flood':
            if is_positive:
                # Flood events: select high-rainfall observations (top 15%)
                rain_threshold = nearby['rainfall_mm'].quantile(0.85)
                filtered = nearby[nearby['rainfall_mm'] >= rain_threshold]
            else:
                # Non-flood: select low/normal rainfall (bottom 50%)
                rain_threshold = nearby['rainfall_mm'].quantile(0.50)
                filtered = nearby[nearby['rainfall_mm'] <= rain_threshold]"""

assert OLD_FLOOD in content, "Could not find flood threshold block!"
content = content.replace(OLD_FLOOD, NEW_FLOOD)
print("✓ Patched flood: top 15% rain for positive, bottom 50% for negative")

# Patch drought thresholds
OLD_DROUGHT = """        elif hz == 'drought':
            if is_positive:
                # Drought events: low rainfall + higher temp
                rain_threshold = nearby['rainfall_mm'].quantile(0.25)
                temp_threshold = nearby['temperature_c'].quantile(0.50)
                filtered = nearby[(nearby['rainfall_mm'] <= rain_threshold) & 
                                  (nearby['temperature_c'] >= temp_threshold)]
            else:
                # Non-drought: normal/wet conditions
                rain_threshold = nearby['rainfall_mm'].quantile(0.40)
                filtered = nearby[nearby['rainfall_mm'] >= rain_threshold]"""

NEW_DROUGHT = """        elif hz == 'drought':
            if is_positive:
                # Drought events: very low rainfall + warmer temp
                rain_threshold = nearby['rainfall_mm'].quantile(0.15)
                temp_threshold = nearby['temperature_c'].quantile(0.40)
                filtered = nearby[(nearby['rainfall_mm'] <= rain_threshold) & 
                                  (nearby['temperature_c'] >= temp_threshold)]
            else:
                # Non-drought: normal/wet conditions
                rain_threshold = nearby['rainfall_mm'].quantile(0.50)
                filtered = nearby[nearby['rainfall_mm'] >= rain_threshold]"""

assert OLD_DROUGHT in content, "Could not find drought threshold block!"
content = content.replace(OLD_DROUGHT, NEW_DROUGHT)
print("✓ Patched drought: bottom 15% rain for positive, top 50% for negative")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print("\nDone! Wider weather gaps should improve flood & drought accuracy.")
