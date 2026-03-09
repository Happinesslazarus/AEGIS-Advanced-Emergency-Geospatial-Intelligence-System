"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS AI ENGINE — Data Labeling Pipeline
 Interactive labeling tool for creating training datasets
═══════════════════════════════════════════════════════════════════════════════

This module provides tools for:
1. Image labeling - download images from reports, manually label hazard type
2. Fake report labeling - review reports, classify as real/fake
3. Severity correction - verify/correct AI-predicted severity
4. Export labeled data for model training

WORKFLOW:
1. Extract data from database
2. Display items for labeling
3. Collect human annotations
4. Save to labeled_data/ directory
5. Use labeled data to train models with ml_pipeline.py
"""

import os
import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd
from loguru import logger

import asyncpg


class DataLabelingPipeline:
    """Interactive data labeling for ML training."""
    
    def __init__(self, db_url: str, output_dir: str = './labeled_data'):
        self.db_url = db_url
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Labeling pipeline initialized - output: {self.output_dir}")
    
    async def export_images_for_labeling(self, limit: int = 100) -> Dict:
        """
        Export reports with images for external labeling.
        
        WORKFLOW:
        1. This extracts media_url from reports
        2. Downloads images locally
        3. Creates labeling spreadsheet
        4. User manually labels each image with hazard type
        5. Import labeled results back
        """
        try:
            conn = await asyncpg.connect(self.db_url)
            
            query = """
            SELECT 
                id, report_number, display_type, 
                media_url, created_at
            FROM reports
            WHERE has_media = true AND media_url IS NOT NULL
            ORDER BY created_at DESC
            LIMIT $1
            """
            
            rows = await conn.fetch(query, limit)
            await conn.close()
            
            df = pd.DataFrame(rows)
            
            # Save for manual labeling
            labeling_file = self.output_dir / 'images_for_labeling.csv'
            df.to_csv(labeling_file, index=False)
            
            logger.success(f"Exported {len(df)} images for labeling")
            logger.info(f"Next steps:")
            logger.info(f"1. Open {labeling_file}")
            logger.info(f"2. Download images from media_url")
            logger.info(f"3. Add 'hazard_type' column with: flood|fire|drought|storm|heatwave|other")
            logger.info(f"4. Save as images_labeled.csv")
            logger.info(f"5. Run import_labeled_images()")
            
            return {
                'status': 'exported',
                'count': len(df),
                'file': str(labeling_file),
                'instructions': 'See log above'
            }
            
        except Exception as e:
            logger.error(f"Image export failed: {e}")
            raise
    
    async def export_reports_for_fake_labeling(self, limit: int = 500) -> Dict:
        """
        Export reports for fake/real classification labeling.
        
        WORKFLOW:
        1. Extract 500 random reports
        2. Create spreadsheet with report details
        3. Users label as: real | spam | misleading | unverifiable
        4. Import labeled results
        5. Train FakeDetector model
        """
        try:
            conn = await asyncpg.connect(self.db_url)
            
            query = """
            SELECT 
                id, report_number, display_type, description,
                severity, status, created_at,
                (SELECT COUNT(*) FROM reports r2 
                 WHERE ST_DWithin(r1.coordinates, r2.coordinates, 1000)
                ) as nearby_reports
            FROM reports r1
            WHERE deleted_at IS NULL
            ORDER BY RANDOM()
            LIMIT $1
            """
            
            rows = await conn.fetch(query, limit)
            await conn.close()
            
            df = pd.DataFrame(rows)
            
            # Save for manual labeling
            labeling_file = self.output_dir / 'reports_for_fake_labeling.csv'
            df.to_csv(labeling_file, index=False)
            
            logger.success(f"Exported {len(df)} reports for labeling")
            logger.info("LABELING GUIDE:")
            logger.info("  real          - Legitimate report with genuine emergency")
            logger.info("  spam          - Commercial spam or irrelevant")
            logger.info("  misleading    - Exaggerated or partially false")
            logger.info("  unverifiable  - Cannot determine authenticity")
            logger.info(f"Next: Edit {labeling_file} and add 'classification' column")
            
            return {
                'status': 'exported',
                'count': len(df),
                'file': str(labeling_file),
                'categories': ['real', 'spam', 'misleading', 'unverifiable']
            }
            
        except Exception as e:
            logger.error(f"Report export failed: {e}")
            raise
    
    async def import_labeled_images(self, csv_path: str) -> Dict:
        """Import labeled image data and prepare for training."""
        try:
            if not os.path.exists(csv_path):
                raise FileNotFoundError(f"Labeled data not found: {csv_path}")
            
            df = pd.read_csv(csv_path)
            
            # Validate
            if 'hazard_type' not in df.columns:
                raise ValueError("CSV must have 'hazard_type' column")
            
            hazard_counts = df['hazard_type'].value_counts()
            logger.info(f"Labeled images distribution:\n{hazard_counts}")
            
            # Check minimum requirements
            min_per_class = 20
            if (hazard_counts < min_per_class).any():
                logger.warning(f"Some classes have <{min_per_class} samples - may affect training")
            
            # Save to standard location
            output_file = self.output_dir / 'images_labeled_final.csv'
            df.to_csv(output_file, index=False)
            
            logger.success(f"Imported {len(df)} labeled images")
            logger.info(f"Ready for model training with ml_pipeline.py")
            
            return {
                'status': 'imported',
                'total_images': len(df),
                'hazard_distribution': hazard_counts.to_dict(),
                'ready_for_training': True
            }
            
        except Exception as e:
            logger.error(f"Import failed: {e}")
            raise
    
    async def import_labeled_reports(self, csv_path: str) -> Dict:
        """Import labeled fake/real report data."""
        try:
            if not os.path.exists(csv_path):
                raise FileNotFoundError(f"Labeled data not found: {csv_path}")
            
            df = pd.read_csv(csv_path)
            
            if 'classification' not in df.columns:
                raise ValueError("CSV must have 'classification' column")
            
            classification_counts = df['classification'].value_counts()
            logger.info(f"Labeled reports distribution:\n{classification_counts}")
            
            # Remap to binary (real vs fake)
            df['is_fake'] = df['classification'].isin(['spam', 'misleading']).astype(int)
            
            # Save
            output_file = self.output_dir / 'reports_labeled_final.csv'
            df.to_csv(output_file, index=False)
            
            logger.success(f"Imported {len(df)} labeled reports")
            logger.info(f"Distribution: real={sum(df['is_fake']==0)}, fake={sum(df['is_fake']==1)}")
            
            return {
                'status': 'imported',
                'total_reports': len(df),
                'real_count': sum(df['is_fake'] == 0),
                'fake_count': sum(df['is_fake'] == 1),
                'ready_for_training': sum(df['is_fake'] == 1) >= 50  # Need min 50 fake examples
            }
            
        except Exception as e:
            logger.error(f"Import failed: {e}")
            raise
    
    async def verify_severity_labels(self, limit: int = 100) -> Dict:
        """
        Export AI-predicted severity for human verification.
        
        This allows operators to:
        1. Review AI predictions
        2. Correct where wrong
        3. Create ground truth dataset
        4. Retrain model on corrected labels
        """
        try:
            conn = await asyncpg.connect(self.db_url)
            
            query = """
            SELECT 
                id, report_number, description,
                severity as human_labeled_severity,
                ai_analysis->>'severity' as ai_predicted_severity,
                ai_analysis->>'confidence' as prediction_confidence,
                created_at
            FROM reports
            WHERE deleted_at IS NULL
            AND ai_analysis IS NOT NULL
            LIMIT $1
            """
            
            rows = await conn.fetch(query, limit)
            await conn.close()
            
            df = pd.DataFrame(rows)
            
            # Identify disagreements
            df['severity_match'] = df['human_labeled_severity'] == df['ai_predicted_severity']
            disagreements = (~df['severity_match']).sum()
            
            output_file = self.output_dir / 'severity_verification.csv'
            df.to_csv(output_file, index=False)
            
            logger.success(f"Exported {len(df)} severity predictions for verification")
            logger.info(f"Disagreements: {disagreements}/{len(df)} ({100*disagreements/len(df):.1f}%)")
            logger.info(f"File: {output_file}")
            
            return {
                'status': 'exported',
                'total_reports': len(df),
                'disagreements': disagreements,
                'accuracy': 1 - (disagreements / len(df))
            }
            
        except Exception as e:
            logger.error(f"Severity export failed: {e}")
            raise


# CLI for labeling workflow
if __name__ == '__main__':
    import sys
    
    db_url = os.getenv(
        'DATABASE_URL',
        'postgresql://postgres:postgres@localhost:5432/aegis'
    )
    
    pipeline = DataLabelingPipeline(db_url)
    
    print("""
    ═══════════════════════════════════════════════════════════════════════
     AEGIS Data Labeling Pipeline
    ═══════════════════════════════════════════════════════════════════════
    
    USAGE:
      python data_labeling_pipeline.py [command]
    
    COMMANDS:
      export-images    - Export reports with images for labeling
      export-fake      - Export reports for fake/real classification
      import-images    - Import labeled images
      import-fake      - Import labeled fake reports
      verify-severity  - Check AI severity predictions vs human labels
    
    WORKFLOW (Image Classification):
      1. python data_labeling_pipeline.py export-images
      2. Download images from media_url, label: flood|fire|drought|etc
      3. Save as images_for_labeling.csv with 'hazard_type' column
      4. python data_labeling_pipeline.py import-images
      5. python ml_pipeline.py train_image_classifier
    
    WORKFLOW (Fake Detection):
      1. python data_labeling_pipeline.py export-fake
      2. Review reports, classify as real|spam|misleading|unverifiable
      3. Save as reports_for_fake_labeling.csv with 'classification' column
      4. python data_labeling_pipeline.py import-fake
      5. python ml_pipeline.py train_fake_detector
    
    ═══════════════════════════════════════════════════════════════════════
    """)
    
    if len(sys.argv) < 2:
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'export-images':
        asyncio.run(pipeline.export_images_for_labeling(300))
    elif command == 'export-fake':
        asyncio.run(pipeline.export_reports_for_fake_labeling(500))
    elif command == 'verify-severity':
        asyncio.run(pipeline.verify_severity_labels(1000))
    else:
        print(f"Unknown command: {command}")
