"""
Augment_minority_classes AI engine module.
"""
import asyncio
import asyncpg
import os
from loguru import logger

DB_URL = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/aegis')

async def augment_minority_classes():
    """
    Check minority class distribution and log actionable warnings.
    NO synthetic reports are created. If categories are under-represented,
    prints instructions for collecting real data.
    """
    conn = await asyncpg.connect(DB_URL)
    try:
        rows = await conn.fetch(
            "SELECT incident_category, COUNT(*) as cnt FROM reports WHERE deleted_at IS NULL GROUP BY incident_category"
        )
        current = {r['incident_category']: r['cnt'] for r in rows}
        total = sum(current.values())
        print("Current distribution:", dict(sorted(current.items(), key=lambda x: -x[1])))

        TARGET = 500
        under_represented = []

        for category in ['storm', 'heatwave', 'drought', 'wildfire', 'infrastructure', 'flood']:
            count = current.get(category, 0)
            if count >= TARGET:
                print(f"  {category}: {count} >= {TARGET} ✓")
            else:
                deficit = TARGET - count
                under_represented.append((category, count, deficit))
                print(f"  {category}: {count} < {TARGET} — needs {deficit} more REAL reports")

        if under_represented:
            print(f"\n⚠ {len(under_represented)} categories are under-represented.")
            print("To fix this, collect REAL reports for these categories:")
            print("  - Run augment_data.py diversify_incident_categories() to re-label existing reports via NLP")
            print("  - Ingest real incident data from public APIs (EA, SEPA, Met Office, DEFRA)")
            print("  - Manually review and re-categorize misclassified reports")
            print("  - Use keyword search on existing descriptions to find mis-labeled reports")
            print("\nSynthetic report generation has been DISABLED.")
            print("The model will train on whatever real data is available.")
            print("Class imbalance can be handled via class_weight='balanced' in the classifier.")
        else:
            print(f"\n✓ All categories meet the target of {TARGET} reports.")

        print(f"\nTotal reports: {total}")
        return current

    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(augment_minority_classes())
