"""
Augment_data AI engine module.
"""

import asyncio
import asyncpg
import os
import re
from loguru import logger

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')

async def augment_reporter_scores(conn: asyncpg.Connection):
    """
    Derive reporter_scores from REAL report data in the database.
    Computes trust scores based on actual submission history:
    - total_reports: COUNT of real reports per reporter_ip
    - genuine_reports: COUNT where status = 'verified'
    - flagged_reports: COUNT where status = 'flagged'
    - fake_reports: COUNT where status IN ('rejected', 'fake')
    - trust_score: genuine / total (with Laplace smoothing)
    - avg_confidence: average ai_confidence from real predictions

    Requires reports to already have reporter_ip values.
    Will NOT generate synthetic profiles.
    """
    logger.info("Deriving reporter scores from REAL report history...")
    
    # Count reports with real reporter_ip values
    ip_count = await conn.fetchval(
        "SELECT COUNT(DISTINCT reporter_ip) FROM reports "
        "WHERE reporter_ip IS NOT NULL AND reporter_ip != '' AND deleted_at IS NULL"
    )
    if ip_count == 0:
        logger.warning(
            "SKIPPING reporter_scores: No reports have reporter_ip values. "
            "Cannot derive trust scores without real reporter identity data."
        )
        return 0

    # Derive scores from actual report outcomes per reporter_ip
    await conn.execute("""
        INSERT INTO reporter_scores
            (ip_hash, total_reports, genuine_reports, flagged_reports, fake_reports,
             avg_confidence, trust_score, last_report_at)
        SELECT
            r.reporter_ip AS ip_hash,
            COUNT(*) AS total_reports,
            COUNT(*) FILTER (WHERE r.status = 'verified') AS genuine_reports,
            COUNT(*) FILTER (WHERE r.status = 'flagged') AS flagged_reports,
            COUNT(*) FILTER (WHERE r.status IN ('rejected', 'fake')) AS fake_reports,
            COALESCE(AVG(r.ai_confidence), 0.5) AS avg_confidence,
            -- Laplace-smoothed trust: (genuine + 1) / (total + 2)
            (COUNT(*) FILTER (WHERE r.status = 'verified') + 1.0) /
            (COUNT(*) + 2.0) AS trust_score,
            MAX(r.created_at) AS last_report_at
        FROM reports r
        WHERE r.reporter_ip IS NOT NULL
          AND r.reporter_ip != ''
          AND r.deleted_at IS NULL
        GROUP BY r.reporter_ip
        ON CONFLICT (ip_hash) DO UPDATE SET
            total_reports = EXCLUDED.total_reports,
            genuine_reports = EXCLUDED.genuine_reports,
            flagged_reports = EXCLUDED.flagged_reports,
            fake_reports = EXCLUDED.fake_reports,
            avg_confidence = EXCLUDED.avg_confidence,
            trust_score = EXCLUDED.trust_score,
            last_report_at = EXCLUDED.last_report_at
    """)

    count = await conn.fetchval("SELECT count(*) FROM reporter_scores")
    logger.success(f"Derived {count} reporter_scores from real report history ({ip_count} unique IPs)")
    return count

async def assign_reporter_ips(conn: asyncpg.Connection):
    """
    Validate reporter_ip data on existing reports.
    Does NOT fabricate or randomly assign IPs — only reports status.
    """
    logger.info("Checking reporter IP assignment status...")
    
    total = await conn.fetchval(
        "SELECT count(*) FROM reports WHERE deleted_at IS NULL"
    )
    has_ips = await conn.fetchval(
        "SELECT count(*) FROM reports WHERE reporter_ip IS NOT NULL AND reporter_ip != '' AND deleted_at IS NULL"
    )
    
    if has_ips == 0:
        logger.warning(
            f"NO reports have reporter_ip values ({total} total reports). "
            "Reporter trust scoring requires real IP/fingerprint data from the web application. "
            "Cannot assign fake IPs — this must come from real user submissions."
        )
    else:
        coverage = (has_ips / total * 100) if total > 0 else 0
        logger.info(f"Reporter IP coverage: {has_ips}/{total} reports ({coverage:.1f}%)")
    
    return has_ips

async def diversify_incident_categories(conn: asyncpg.Connection):
    """
    Re-label a subset of existing flood reports based on text content
    analysis to create multi-class training data for the classifier.
    
    Strategy (REAL DATA ONLY — no synthetic descriptions):
    - Analyze description text for keywords matching non-flood hazards
    - Re-label reports that genuinely mention drought/heat/storm/wildfire/infrastructure
    - Keep the majority as flood (realistic for UK)
    - Log warnings if categories remain under-represented
    """
    logger.info("Diversifying incident categories via keyword NLP re-labeling...")
    
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

    # Keyword-based reassignment ONLY — no synthetic fallback
    reassignments = {cat: [] for cat in category_keywords}
    already_assigned = set()

    for row in reports:
        text = f"{row['display_type'] or ''} {row['description'] or ''}".lower()
        for category, patterns in category_keywords.items():
            if row['id'] in already_assigned:
                break
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    reassignments[category].append(row['id'])
                    already_assigned.add(row['id'])
                    break

    # Batch-update the categories — ONLY real keyword matches
    total_reassigned = 0
    for category, report_ids in reassignments.items():
        if report_ids:
            await conn.execute("""
                UPDATE reports SET incident_category = $1
                WHERE id = ANY($2::uuid[])
            """, category, report_ids)
            total_reassigned += len(report_ids)
            logger.info(f"  → {category}: {len(report_ids)} reports re-labeled via keyword match")
        else:
            logger.warning(
                f"  → {category}: 0 keyword matches found in existing reports. "
                f"Under-represented category — add REAL {category} reports to improve training."
            )

    # Final distribution
    final_dist = await conn.fetch("""
        SELECT incident_category, count(*) as cnt
        FROM reports WHERE deleted_at IS NULL
        GROUP BY incident_category ORDER BY cnt DESC
    """)
    result = {row['incident_category']: row['cnt'] for row in final_dist}
    logger.success(f"Final category distribution: {result}")
    logger.success(f"Total re-labeled from real keyword analysis: {total_reassigned}")
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
