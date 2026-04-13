"""
Module: patch_seeder3.py

Patch_seeder3 utility script.

Simple explanation:
Standalone script for patch_seeder3.
"""

f = r'e:\aegis-v6-fullstack\aegis-v6\server\scripts\seed_training_data.py'
t = open(f, 'r', encoding='utf-8').read()

# Fix: can't reference r.get("has_media") while building the dict
# Change to use a variable set before the dict
old = '"has_media": random.random() < 0.4,\n            "media_type": random.choice(["image/jpeg", "image/png", "video/mp4", None]) if r.get("has_media") else None,'
new = '"has_media": has_media_flag,\n            "media_type": random.choice(["image/jpeg", "image/png", "video/mp4"]) if has_media_flag else None,'

if old in t:
    t = t.replace(old, new)
    # Add has_media_flag before the report dict
    t = t.replace(
        'report_id = str(uuid.uuid4())',
        'has_media_flag = random.random() < 0.4\n        report_id = str(uuid.uuid4())'
    )
    print('Fixed has_media reference')
else:
    print('Pattern not found, trying alternative...')
    # Try a simpler fix
    t = t.replace(
        'if r.get("has_media") else None',
        'if random.random() < 0.5 else None'
    )
    print('Applied simple fix')

open(f, 'w', encoding='utf-8').write(t)
