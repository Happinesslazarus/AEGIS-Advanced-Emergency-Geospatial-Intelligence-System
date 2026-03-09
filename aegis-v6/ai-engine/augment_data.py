"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Data Augmentation for Phase 5 Model Training
 
 Addresses dataset insufficiency:
 1. Generates reporter_scores with realistic trust distributions
 2. Assigns diverse reporter IPs to reports (for fake detector training)
 3. Adds diverse incident categories (drought, heatwave, storm, wildfire)
    by re-labeling a subset of existing reports based on text analysis
═══════════════════════════════════════════════════════════════════════════════
"""

import asyncio
import asyncpg
import hashlib
import os
import random
import re
from datetime import datetime, timedelta
from loguru import logger

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')


async def augment_reporter_scores(conn: asyncpg.Connection):
    """
    Generate reporter_scores for realistic fake detector training.
    Creates 500 synthetic reporter profiles with varied trust distributions:
    - 70% genuine reporters (trust > 0.6)
    - 20% moderate reporters (trust 0.3-0.6)
    - 10% suspicious reporters (trust < 0.3)
    """
    logger.info("Generating reporter scores...")
    
    existing = await conn.fetchval("SELECT count(*) FROM reporter_scores")
    if existing > 50:
        logger.info(f"Already have {existing} reporter_scores, skipping")
        return existing

    reporters = []
    for i in range(500):
        ip_hash = hashlib.md5(f"reporter_{i}_{random.randint(1000,9999)}".encode()).hexdigest()
        fp_hash = hashlib.md5(f"fp_{i}_{random.randint(1000,9999)}".encode()).hexdigest()

        # Determine trust category
        r = random.random()
        if r < 0.70:  # genuine
            total = random.randint(5, 80)
            genuine = max(1, int(total * random.uniform(0.7, 0.95)))
            flagged = random.randint(0, max(1, total - genuine))
            fake = max(0, total - genuine - flagged)
            trust = round(random.uniform(0.60, 0.98), 4)
            avg_conf = round(random.uniform(0.6, 0.95), 4)
        elif r < 0.90:  # moderate
            total = random.randint(2, 30)
            genuine = max(1, int(total * random.uniform(0.3, 0.7)))
            flagged = random.randint(1, max(2, total - genuine))
            fake = max(0, total - genuine - flagged)
            trust = round(random.uniform(0.30, 0.60), 4)
            avg_conf = round(random.uniform(0.35, 0.65), 4)
        else:  # suspicious
            total = random.randint(1, 15)
            genuine = random.randint(0, max(1, total // 3))
            flagged = random.randint(1, max(2, total - genuine))
            fake = max(0, total - genuine - flagged)
            trust = round(random.uniform(0.05, 0.30), 4)
            avg_conf = round(random.uniform(0.1, 0.4), 4)

        days_ago = random.randint(1, 180)
        last_report = datetime.utcnow() - timedelta(days=days_ago)

        reporters.append((
            fp_hash, ip_hash, total, genuine, flagged, fake,
            avg_conf, trust, last_report
        ))

    await conn.executemany("""
        INSERT INTO reporter_scores
            (fingerprint_hash, ip_hash, total_reports, genuine_reports,
             flagged_reports, fake_reports, avg_confidence, trust_score, last_report_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
    """, reporters)

    count = await conn.fetchval("SELECT count(*) FROM reporter_scores")
    logger.success(f"Generated {count} reporter_scores")
    return count


async def assign_reporter_ips(conn: asyncpg.Connection):
    """
    Assign diverse reporter IPs to reports so the fake detector
    can JOIN against reporter_scores for trust signals.
    """
    logger.info("Assigning reporter IPs to reports...")
    
    # Check if reports already have IPs
    has_ips = await conn.fetchval(
        "SELECT count(*) FROM reports WHERE reporter_ip IS NOT NULL AND reporter_ip != '' AND deleted_at IS NULL"
    )
    if has_ips > 100:
        logger.info(f"Already have {has_ips} reports with IPs, skipping")
        return has_ips

    # Get all reporter IP hashes
    ips = await conn.fetch("SELECT ip_hash FROM reporter_scores")
    if not ips:
        logger.warning("No reporter_scores to assign — run augment_reporter_scores first")
        return 0

    ip_list = [row['ip_hash'] for row in ips]

    # Get all report IDs
    report_ids = await conn.fetch(
        "SELECT id FROM reports WHERE deleted_at IS NULL ORDER BY created_at"
    )

    # Assign IPs - some reporters have many reports, most have few
    # Weight distribution: top 20% of reporters get 60% of reports
    frequent = ip_list[:int(len(ip_list) * 0.2)]
    occasional = ip_list[int(len(ip_list) * 0.2):]

    batch = []
    for row in report_ids:
        if random.random() < 0.6 and frequent:
            ip = random.choice(frequent)
        elif occasional:
            ip = random.choice(occasional)
        else:
            ip = random.choice(ip_list)
        batch.append((ip, row['id']))

    # Batch update
    await conn.executemany(
        "UPDATE reports SET reporter_ip = $1 WHERE id = $2",
        batch
    )

    updated = await conn.fetchval(
        "SELECT count(*) FROM reports WHERE reporter_ip IS NOT NULL AND reporter_ip != '' AND deleted_at IS NULL"
    )
    logger.success(f"Assigned IPs to {updated} reports")
    return updated


async def diversify_incident_categories(conn: asyncpg.Connection):
    """
    Re-label a subset of existing flood reports based on text content
    analysis to create multi-class training data for the classifier.
    
    Strategy:
    - Analyze description text for keywords
    - Re-label reports that mention drought/heat/storm/wildfire/infrastructure
    - Keep the majority as flood (realistic for UK)
    - Target: at least 100 samples in each non-flood category
    """
    logger.info("Diversifying incident categories...")
    
    # Check current distribution
    dist = await conn.fetch("""
        SELECT incident_category, count(*) as cnt
        FROM reports WHERE deleted_at IS NULL
        GROUP BY incident_category ORDER BY cnt DESC
    """)
    current_dist = {row['incident_category']: row['cnt'] for row in dist}
    
    non_flood_total = sum(v for k, v in current_dist.items() if k != 'flood')
    if non_flood_total > 500:
        logger.info(f"Already have {non_flood_total} non-flood reports, skipping diversification")
        return current_dist

    # Keyword-based re-labeling rules
    category_keywords = {
        'storm': [
            r'\bstorm\b', r'\bwind\b', r'\bgale\b', r'\bhurricane\b', r'\btornado\b',
            r'\blightning\b', r'\bthunder\b', r'\bblown\b', r'\btree.?fell\b',
            r'\bpower.?out\b', r'\bpower.?cut\b', r'\broof\b', r'\btiles?\b',
            r'\bdamage.*wind\b', r'\bwindow\b.*\bsmashed\b'
        ],
        'heatwave': [
            r'\bheat\b', r'\bhot\b', r'\btemperature\b', r'\bscorch\b',
            r'\bsunstroke\b', r'\bheat.?stroke\b', r'\bdehydrat\b',
            r'\brecord.?temp\b', r'\bextreme.?heat\b', r'\bcooling\b.*\bcentr\b',
        ],
        'drought': [
            r'\bdrought\b', r'\bdry\b.*\bspell\b', r'\bwater.?shortage\b',
            r'\bcrop.?fail\b', r'\breservoir\b.*\blow\b', r'\bhosepipe\b.*\bban\b',
            r'\bwater.?restrict\b', r'\barid\b', r'\bparch\b',
        ],
        'wildfire': [
            r'\bfire\b', r'\bblaze\b', r'\bsmoke\b', r'\bburn\b', r'\bflames?\b',
            r'\bwildfire\b', r'\bbush.?fire\b', r'\bforest.?fire\b',
            r'\barson\b', r'\bheather.?fire\b',
        ],
        'infrastructure': [
            r'\bbridge\b.*\bcollaps\b', r'\bpipe\b.*\bburst\b', r'\bsewer\b',
            r'\bpothole\b', r'\bdam\b.*\b(breach|damage|fail)\b',
            r'\bpower.?grid\b', r'\bgas.?leak\b', r'\bsinkhole\b',
            r'\bbuilding\b.*\bcollaps\b',
        ],
    }

    # Fetch all flood reports with descriptions
    reports = await conn.fetch("""
        SELECT id, description, display_type
        FROM reports
        WHERE incident_category = 'flood' AND deleted_at IS NULL
          AND LENGTH(COALESCE(description, '')) > 20
        ORDER BY random()
    """)

    logger.info(f"Analyzing {len(reports)} flood reports for category reassignment...")

    # First pass: keyword-based reassignment
    reassignments = {cat: [] for cat in category_keywords}
    target_per_category = 150  # aim for 150 per non-flood category

    for row in reports:
        text = f"{row['display_type'] or ''} {row['description'] or ''}".lower()
        for category, patterns in category_keywords.items():
            if len(reassignments[category]) >= target_per_category:
                continue
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    reassignments[category].append(row['id'])
                    break

    # Second pass: if not enough keyword matches, do synthetic reassignment
    # (update description to include relevant keywords and change category)
    category_descriptions = {
        'storm': [
            "Strong winds caused significant damage to properties.",
            "Storm brought down trees and power lines.",
            "Severe gale force winds ripping roof tiles from houses.",
            "Thunder and lightning storm causing widespread power cuts.",
            "Wind damage reported across multiple neighbourhoods.",
            "Fallen tree blocking the main road after storm.",
            "Hurricane force winds damaging fences and sheds.",
            "Storm surge and high winds causing coastal damage.",
        ],
        'heatwave': [
            "Extreme heat wave causing health concerns for elderly.",
            "Record temperatures above 35C for third consecutive day.",
            "Cooling centres opened due to dangerous heat conditions.",
            "Heat stroke cases reported at local hospital.",
            "Hot weather causing road surfaces to melt and buckle.",
            "Temperature exceeded 38C, schools closing early.",
            "Heatwave affecting water supply, reservoir levels critical.",
            "Extreme heat causing railway tracks to expand and buckle.",
        ],
        'drought': [
            "Severe drought conditions affecting agriculture.",
            "Water shortage forcing hosepipe ban across region.",
            "Crop failure due to prolonged dry spell.",
            "Reservoir levels critically low after months without rain.",
            "Drought emergency declared, water rationing in effect.",
            "River levels at record low, fish population at risk.",
            "Water restrictions imposed on all non-essential use.",
            "Dry conditions increasing wildfire risk in rural areas.",
        ],
        'wildfire': [
            "Wildfire spreading rapidly across moorland.",
            "Forest fire threatening nearby residential area.",
            "Smoke from bush fire reducing visibility on roads.",
            "Flames seen approaching farmland from heather fire.",
            "Emergency services battling large blaze in woodland.",
            "Fire service responding to wildfire near village.",
            "Arson suspected as cause of major grassland fire.",
            "Moorland fire burning out of control, helicopters deployed.",
        ],
        'infrastructure': [
            "Major water pipe burst flooding streets.",
            "Bridge showing structural damage after inspection.",
            "Sinkhole appeared on residential road, cars damaged.",
            "Gas leak detected near primary school, evacuation ordered.",
            "Dam overflow threatening downstream properties.",
            "Sewer backup causing raw sewage to surface in gardens.",
            "Building partially collapsed after foundation issues.",
            "Power grid failure leaving thousands without electricity.",
        ],
    }

    # For categories that need more samples, add synthetic reports
    for category, report_ids in reassignments.items():
        deficit = target_per_category - len(report_ids)
        if deficit > 0:
            logger.info(f"Category '{category}': {len(report_ids)} keyword matches, creating {deficit} synthetic entries")
            descs = category_descriptions.get(category, [])
            
            # Pick random flood reports to re-purpose
            available = await conn.fetch(f"""
                SELECT id FROM reports
                WHERE incident_category = 'flood' AND deleted_at IS NULL
                  AND id NOT IN (SELECT unnest($1::uuid[]))
                ORDER BY random()
                LIMIT {deficit}
            """, [rid for rids in reassignments.values() for rid in rids])
            
            for j, row in enumerate(available):
                if j < len(descs):
                    # Update the description to match the new category
                    new_desc = f"{descs[j % len(descs)]} {random.choice(descs)}"
                    await conn.execute(
                        "UPDATE reports SET description = $1 WHERE id = $2",
                        new_desc, row['id']
                    )
                report_ids.append(row['id'])

    # Now batch-update the categories
    total_reassigned = 0
    for category, report_ids in reassignments.items():
        if report_ids:
            actual = report_ids[:target_per_category]
            await conn.execute(f"""
                UPDATE reports SET incident_category = $1
                WHERE id = ANY($2::uuid[])
            """, category, actual)
            total_reassigned += len(actual)
            logger.info(f"  → {category}: {len(actual)} reports")

    # Final distribution
    final_dist = await conn.fetch("""
        SELECT incident_category, count(*) as cnt
        FROM reports WHERE deleted_at IS NULL
        GROUP BY incident_category ORDER BY cnt DESC
    """)
    result = {row['incident_category']: row['cnt'] for row in final_dist}
    logger.success(f"Final category distribution: {result}")
    logger.success(f"Total reassigned: {total_reassigned}")
    return result


async def main():
    logger.info("Starting Phase 5 data augmentation...")
    conn = await asyncpg.connect(DB_URL)
    try:
        # Step 1: Generate reporter scores
        reporter_count = await augment_reporter_scores(conn)
        logger.info(f"Reporter scores: {reporter_count}")

        # Step 2: Assign IPs to reports
        ip_count = await assign_reporter_ips(conn)
        logger.info(f"Reports with IPs: {ip_count}")

        # Step 3: Diversify categories
        dist = await diversify_incident_categories(conn)
        logger.info(f"Category distribution: {dist}")

        logger.success("Data augmentation complete!")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
