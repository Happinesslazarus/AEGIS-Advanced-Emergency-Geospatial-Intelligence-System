"""Patch data_loaders.py to load both positive and negative examples for hazard training."""
import re

filepath = r"E:\aegis-v6-fullstack\aegis-v6\ai-engine\app\training\data_loaders.py"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old = """        # Load all required data sources
        reports = await self.load_historical_reports(start_date, end_date, hazard_type)

        # STRICT VALIDATION: No fallback logic - fail immediately if insufficient data
        if reports.empty:
            error_msg = (
                f"TRAINING ABORTED: No historical reports found for hazard type '{hazard_type}' "
                f"between {start_date} and {end_date}. Training cannot proceed on empty datasets. "
                f"Please run data ingestion pipeline first to populate the database with real data."
            )
            logger.error(error_msg)
            raise ValueError(error_msg)"""

new = """        # Load positive examples (matching hazard type)
        positive_reports = await self.load_historical_reports(start_date, end_date, hazard_type)

        # STRICT VALIDATION: No fallback logic - fail immediately if insufficient data
        if positive_reports.empty:
            error_msg = (
                f"TRAINING ABORTED: No historical reports found for hazard type '{hazard_type}' "
                f"between {start_date} and {end_date}. Training cannot proceed on empty datasets. "
                f"Please run data ingestion pipeline first to populate the database with real data."
            )
            logger.error(error_msg)
            raise ValueError(error_msg)

        # Load negative examples (other hazard types) for binary classification
        all_reports = await self.load_historical_reports(start_date, end_date, None)
        negative_reports = all_reports[~all_reports['id'].isin(positive_reports['id'])]
        # Sample negatives proportional to positives (max 1:1 ratio)
        n_neg = min(len(negative_reports), len(positive_reports))
        if n_neg > 0:
            negative_reports = negative_reports.sample(n=n_neg, random_state=42)
        reports = pd.concat([positive_reports, negative_reports], ignore_index=True)
        logger.info(f"Training set: {len(positive_reports)} positive + {n_neg} negative = {len(reports)} total")"""

if old in content:
    content = content.replace(old, new)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Patched data_loaders.py")
else:
    print("ERROR: Old text not found in file")
    # Debug: find the approximate location
    for i, line in enumerate(content.split('\n'), 1):
        if 'Load all required' in line or 'load_historical_reports' in line:
            print(f"  Line {i}: {line.strip()}")
