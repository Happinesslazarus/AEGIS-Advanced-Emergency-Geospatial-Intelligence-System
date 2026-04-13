"""
Module: fix_severity_labels.py

Fix_severity_labels utility script.

Simple explanation:
Standalone script for fix_severity_labels.
"""

import os
"""Update severity labels to be correlated with text features for better ML training."""
import asyncio
import asyncpg
import re

DB_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost:5432/aegis')

# Keywords that indicate severity levels
CRITICAL_KEYWORDS = [
    'catastrophic', 'life-threatening', 'emergency evacuation', 'major disaster',
    'widespread destruction', 'multiple casualties', 'collapsed', 'completely destroyed',
    'unprecedented', 'state of emergency', 'trapped persons', 'mass evacuation',
    'extreme danger', 'critical infrastructure', 'dam breach', 'levee failure',
]

HIGH_KEYWORDS = [
    'severe', 'dangerous', 'significant damage', 'road closed', 'major flooding',
    'structural damage', 'power outage', 'submerged', 'rising rapidly',
    'homes evacuated', 'rescue operation', 'substantial', 'engulfed',
    'rapidly spreading', 'out of control', 'overwhelmed', 'hospital',
]

MEDIUM_KEYWORDS = [
    'moderate', 'affecting', 'disruption', 'warning issued', 'some damage',
    'surface water', 'garden flooding', 'precautionary', 'advisory',
    'monitoring', 'potential risk', 'localised', 'partial',
]

LOW_KEYWORDS = [
    'minor', 'small', 'limited', 'no significant', 'puddle', 'slight',
    'resolved', 'clearing', 'receding', 'contained', 'under control',
    'no damage', 'superficial', 'brief',
]

def classify_severity(description: str, incident_category: str, trapped: str, has_media: bool) -> str:
    """Determine severity based on text content and metadata."""
    text = description.lower()
    
    # Score-based approach
    score = 0
    
    # Keyword matching
    for kw in CRITICAL_KEYWORDS:
        if kw in text:
            score += 4
    for kw in HIGH_KEYWORDS:
        if kw in text:
            score += 2
    for kw in MEDIUM_KEYWORDS:
        if kw in text:
            score += 1
    for kw in LOW_KEYWORDS:
        if kw in text:
            score -= 1
    
    # Text length (longer descriptions tend to be more serious)
    if len(text) > 200:
        score += 2
    elif len(text) > 100:
        score += 1
    
    # Trapped persons
    if trapped and trapped not in ('0', 'no', 'none', ''):
        score += 3
    
    # Has media
    if has_media:
        score += 1
    
    # Category-based adjustments
    if incident_category in ('wildfire', 'flood'):
        score += 1  # Generally more severe
    
    # Number mentions (e.g., "50 homes", "3 metres")
    numbers = re.findall(r'\b(\d+)\b', text)
    for n in numbers:
        val = int(n)
        if val > 100:
            score += 2
        elif val > 10:
            score += 1
    
    # Map score to severity
    if score >= 8:
        return 'critical'
    elif score >= 5:
        return 'high'
    elif score >= 2:
        return 'medium'
    else:
        return 'low'

async def main():
    conn = await asyncpg.connect(DB_URL)
    
    rows = await conn.fetch("""
        SELECT id, description, incident_category, trapped_persons, has_media
        FROM reports WHERE deleted_at IS NULL
    """)
    
    counts = {'low': 0, 'medium': 0, 'high': 0, 'critical': 0}
    updates = []
    
    for r in rows:
        new_sev = classify_severity(
            r['description'] or '',
            r['incident_category'] or '',
            r['trapped_persons'] or '0',
            r['has_media'] or False
        )
        counts[new_sev] += 1
        updates.append((new_sev, r['id']))
    
    # Batch update
    await conn.executemany(
        "UPDATE reports SET severity = $1::report_severity WHERE id = $2",
        updates
    )
    
    await conn.close()
    
    print(f"Updated {len(updates)} report severities:")
    for k, v in counts.items():
        print(f"  {k}: {v}")

asyncio.run(main())
