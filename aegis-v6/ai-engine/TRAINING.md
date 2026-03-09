"""
═══════════════════════════════════════════════════════════════════════════════
 AEGIS PRODUCTION ML IMPLEMENTATION GUIDE
 Real ML Models Trained on Historical Database Reports
═══════════════════════════════════════════════════════════════════════════════

CRITICAL RULE: NO synthetic data, NO heuristics, ONLY real ML trained on production data
"""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: REPORT CLASSIFICATION (HAZARD TYPE)
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: ✅ READY TO TRAIN

## AVAILABLE DATA:
- 7,000+ real reports in database
- Each report has:
  - description (text)
  - display_type (incident category)
  - incident_category, incident_subtype
  - creation timestamp
  
## FEATURES:
- TF-IDF vectorization of description + display_type
- Incident subtype encoding
- Total: 200+ engineered features

## TRAINING:
```bash
cd ai-engine
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/aegis"
export MODEL_REGISTRY_PATH="./model_registry"
python -m app.training.ml_pipeline
```

## RESULT:
- XGBoost model saved to: model_registry/report_classifier/model_YYYYMMDD_HHMMSS.pkl
- Metrics logged: accuracy, precision, recall, F1, AUC
- Model ready for inference

## TEST:
```bash
curl -X POST http://localhost:8000/api/classify-report \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Major flooding in Edinburgh city center",
    "description": "Water levels rising, emergency services responding"
  }'
```


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: SEVERITY PREDICTION
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: ✅ READY TO TRAIN

## AVAILABLE DATA:
- 7,000+ reports with human-labeled severity (low/medium/high)
- Features:
  - Description text (TF-IDF)
  - Text length
  - Trapped persons (yes/no)
  - Has media (yes/no)
  - Report creation hour
  
## TRAINING:
```bash
python -m app.training.ml_pipeline  # Includes severity predictor
```

## RESULT:
- XGBoost model for multi-class severity prediction
- Classes: low, medium, high
- Saved to: model_registry/severity_predictor/model_*.pkl

## TEST:
```bash
curl -X POST http://localhost:8000/api/predict-severity \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Widespread flooding affecting 5 neighborhoods",
    "trapped_persons": 3,
    "affected_area_km2": 2.5
  }'
```


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: IMAGE CLASSIFICATION (FUTURE)
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: ⏳ REQUIRES LABELING

## AVAILABLE DATA:
- ~3,000 reports have media_url (images)
- NOT YET LABELED BY HAZARD TYPE

## WORKFLOW:
1. Export images for labeling:
   ```bash
   python -m app.training.data_labeling_pipeline export-images
   ```

2. This creates: labeled_data/images_for_labeling.csv
   With columns: id, report_number, display_type, media_url, created_at

3. MANUAL LABELING (8-16 hours):
   - Download each image from media_url
   - Classify as: flood | wildfire | drought | heatwave | storm | other
   - Add "hazard_type" column to CSV

4. Import labeled data:
   ```bash
   python -m app.training.data_labeling_pipeline import-images labeled_data/images_for_labeling.csv
   ```

5. Train model:
   ```bash
   python -m app.training.ml_pipeline train_image_classifier
   ```

## TECHNOLOGY:
- ResNet50 or EfficientNet (transfer learning)
- Fine-tuned on 300+ labeled disaster images
- PyTorch or TensorFlow
- Results: model_registry/image_classifier/model_*.pt


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: FAKE DETECTION (FUTURE)
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: ⏳ REQUIRES LABELING

## AVAILABLE DATA:
- 7,000+ reports
- NOT YET CLASSIFIED AS REAL/FAKE

## WORKFLOW:
1. Export reports for labeling:
   ```bash
   python -m app.training.data_labeling_pipeline export-fake
   ```

2. This creates: labeled_data/reports_for_fake_labeling.csv
   With columns: id, report_number, display_type, description, severity, status, created_at, nearby_reports

3. MANUAL LABELING (20-30 hours):
   - Review each report
   - Classify as:
     * real          = Legitimate emergency report
     * spam          = Commercial spam or irrelevant
     * misleading    = Exaggerated or partially false
     * unverifiable  = Cannot determine
   - Add "classification" column

4. Import labeled data:
   ```bash
   python -m app.training.data_labeling_pipeline import-fake labeled_data/reports_for_fake_labeling.csv
   ```

5. Train model:
   ```bash
   python -m app.training.ml_pipeline train_fake_detector
   ```

## FEATURES:
- User reputation
- Submission frequency
- Report text quality
- Location verification
- Corroboration (nearby similar reports)
- Source type
- Image availability

## MODEL:
- RandomForest or XGBoost (binary: real vs fake)
- Results: model_registry/fake_detector/model_*.pkl


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: MODEL DRIFT DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: 🔄 IN PROGRESS

## IMPLEMENTATION:
Monitor model performance over time:
- Track prediction accuracy on labeled holdout set
- Compare new predictions vs ground truth
- Alert if performance drops >5%

## CODE:
```python
from app.monitoring.drift_detector import ModelDriftMonitor

monitor = ModelDriftMonitor(
    model_registry_path='./model_registry',
    alert_threshold=0.05  # 5% drop
)

# Check every hour
await monitor.check_drift()
```

## AUTO-RETRAINING:
When drift detected:
1. Load latest training data from database
2. Re-engineer features
3. Retrain model with new data
4. Evaluate performance
5. Compare to current model
6. If better, promote to production


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: A/B TESTING FRAMEWORK
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: 🔄 IN PROGRESS

## GOAL:
Compare model versions safely on production traffic

## IMPLEMENTATION:
```python
from app.ab_testing import ABTester

tester = ABTester(
    model_registry_path='./model_registry',
    split_ratio={'model_v1': 0.5, 'model_v2': 0.5}
)

# Route predictions to different models
result = tester.predict(
    model_type='report_classifier',
    request=request
)

# Result includes:
# - prediction
# - model_version (v1 or v2)
# - metrics tracked for comparison
```

## METRICS TRACKED:
- Accuracy on labeled holdout set
- Latency
- User feedback (if available)
- Downstream task success


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: WEBSOCKET REAL-TIME PREDICTIONS
# ═══════════════════════════════════════════════════════════════════════════════

## STATUS: 🔄 IN PROGRESS

## GOAL:
Stream predictions to frontend in real-time

## IMPLEMENTATION:
```python
@app.websocket("/ws/predict")
async def websocket_predict(websocket: WebSocket):
    await websocket.accept()
    
    while True:
        data = await websocket.receive_json()
        
        # Get prediction
        result = await predictor.predict(data)
        
        # Stream back
        await websocket.send_json(result)
```

## FRONTEND USAGE:
```typescript
const ws = new WebSocket('ws://localhost:8000/ws/predict');

ws.onmessage = (event) => {
  const prediction = JSON.parse(event.data);
  console.log('Got prediction:', prediction);
};

ws.send(JSON.stringify({
  text: reportText,
  description: reportDesc
}));
```

## BENEFITS:
- Low latency
- Real-time feedback
- Can integrate with map visualization


# ═══════════════════════════════════════════════════════════════════════════════
# QUICK START CHECKLIST
# ═══════════════════════════════════════════════════════════════════════════════

- [x] Report Classifier (Ready to train now)
- [x] Severity Predictor (Ready to train now)
- [ ] Image Classifier (Awaiting labeling - 8-16 hours)
- [ ] Fake Detector (Awaiting labeling - 20-30 hours)
- [ ] Drift Detection (Implementation in progress)
- [ ] A/B Testing (Implementation in progress)
- [ ] WebSocket Support (Implementation in progress)
- [ ] Multer File Uploads (Implementation pending)

## IMMEDIATE NEXT STEPS:

### 1. Train report classifier (5 minutes)
```bash
cd aegis-v6/ai-engine
python -m app.training.ml_pipeline
```

### 2. Test API endpoints
```bash
curl http://localhost:8000/api/classify-report -X POST -d '...'
```

### 3. Schedule image labeling campaign
- Allocate 8-16 hours
- Get 3-5 people to label images
- Use data_labeling_pipeline.py

### 4. Schedule fake report review
- Allocate 20-30 hours  
- Review 500 reports
- Classify as real/spam/misleading

### 5. Begin implementing drift detection
- Monitor model performance
- Set up alerts
- Auto-retrain triggers


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE SCHEMA NOTES
# ═══════════════════════════════════════════════════════════════════════════════

REPORTS TABLE STRUCTURE:
- id (UUID)
- description (TEXT) - Main report text
- display_type (VARCHAR) - Incident type/category
- incident_category (VARCHAR)
- incident_subtype (VARCHAR)
- severity (ENUM: low/medium/high) - LABELED DATA ✅
- status (ENUM: unverified/verified/urgent/flagged/resolved)
- trapped_persons (VARCHAR: yes/no)
- has_media (BOOLEAN) - Has image/video
- media_url (VARCHAR) - Download URL
- ai_analysis (JSONB) - Store ML outputs here
- created_at (TIMESTAMPTZ)

AI_PREDICTIONS TABLE:
- id (UUID)
- hazard_type (VARCHAR)
- region_id (VARCHAR)
- probability (FLOAT)
- risk_level (VARCHAR)
- confidence (FLOAT)
- model_version (VARCHAR)
- generated_at (TIMESTAMPTZ)


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTION DEPLOYMENT CHECKLIST
# ═══════════════════════════════════════════════════════════════════════════════

Before deploying to production:

- [ ] Train all models on latest data
- [ ] Evaluate metrics (accuracy, precision, recall, F1)
- [ ] Test with 100+ examples
- [ ] Benchmark latency (target <200ms)
- [ ] Set up monitoring/alerting
- [ ] Create model rollback procedure
- [ ] Document decision boundaries for each model
- [ ] Get stakeholder sign-off on predictions
- [ ] Deploy with feature flag for gradual rollout
- [ ] Monitor drift in production
- [ ] Set up auto-retraining pipeline

SIGN-OFF REQUIRED FROM:
- [ ] AI/ML lead
- [ ] Operations team
- [ ] Legal/Compliance (for false positive rates)
"""
