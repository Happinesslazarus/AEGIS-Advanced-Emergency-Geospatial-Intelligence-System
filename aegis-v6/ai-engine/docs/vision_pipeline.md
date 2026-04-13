# AEGIS Vision Pipeline — End-to-End Guide

This document explains how images submitted to AEGIS incidents are processed
through the vision and multimodal pipeline: from raw upload to a fused hazard
prediction with damage severity.

---

## Architecture overview

```
Image upload
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│  MultimodalFusionService  (app/services/multimodal_fusion.py) │
│                                                               │
│   ┌─────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│   │ MLScorer│   │  CLIPScorer  │   │     NLPScorer        │  │
│   │(hazard  │   │(ViT-B/32     │   │(keyword frequency    │  │
│   │ models) │   │ fine-tuned   │   │ per hazard type)     │  │
│   └────┬────┘   └──────┬───────┘   └──────────┬───────────┘  │
│        │               │                       │              │
│        └──────────────Bayesian─────────────────┘              │
│                        Average                                │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│  CLIPScorer (damage branch)                                   │
│  model_registry/clip/clip_damage_severity_vit_b32.pt          │
│  → severity_class: no_damage | minor | major | destroyed      │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
  FusionResult  { incident_type, confidence, damage_severity, … }
```

---

## 1. CLIP model — training and versioning

### 1a. Phase 1: crisis classifier

**Script:** `training/finetune_clip.py`

Trains CLIP ViT-B/32 on three crisis image datasets to classify images into
seven hazard classes (flood, fire, hurricane, earthquake, landslide,
infrastructure_damage, not_disaster).

**Training schedule — 10 epochs, 3 phases:**

| Epochs | Unfrozen layers | LR |
|---|---|---|
| 1–3 | Projection head only | 1e-4 |
| 4–7 | + last 4 vision transformer blocks | 5e-5 |
| 8–10 | Full vision encoder | 1e-5 |

The text encoder is **always frozen** — its language understanding is
already excellent for crisis text from the original CLIP pretraining.

**Run:**
```bash
cd aegis-v6/ai-engine
python training/finetune_clip.py \
    --epochs 10 \
    --batch 32 \
    --fp16
```

**Expected results** (RTX 2060 SUPER, ~4 h):

| Model | AEGIS benchmark accuracy |
|---|---|
| Zero-shot CLIP (standard prompts) | ~52% |
| Zero-shot CLIP (crisis prompts)   | ~61% |
| Fine-tuned (this script)          | **75–82%** |

**Checkpoint saved to:** `model_registry/clip/clip_crisis_vit_b32.pt`

---

### 1b. Phase 2: damage severity head

**Script:** `training/finetune_clip_damage_severity.py`

Loads the crisis checkpoint and adds a 4-class severity head
(`CLIPSeverityClassifier`) trained on xBD post-event satellite images.

```
CLIP vision encoder  (frozen)
           ↓
  LayerNorm(512)
           ↓
  Linear(512 → 256) + GELU + Dropout(0.3)
           ↓
  Linear(256 → 4)
  [no_damage, minor, major, destroyed]
```

Uses weighted CrossEntropyLoss (class weights ≈ 1:3:5:4 from xBD imbalance).

**Run:**
```bash
python training/finetune_clip_damage_severity.py \
    --epochs 15 \
    --batch 64 \
    --base-checkpoint model_registry/clip/clip_crisis_vit_b32.pt
```

**Checkpoint saved to:** `model_registry/clip/clip_damage_severity_vit_b32.pt`

---

## 2. MultimodalFusionService — inference

**Module:** `app/services/multimodal_fusion.py`

### 2a. Startup

On the first `fuse()` call the service lazily loads:
- All `.pkl` hazard models from `model_registry/<hazard>/`
- `clip_crisis_vit_b32.pt` and `clip_damage_severity_vit_b32.pt`

Pre-computed text embeddings for all 7 class prompts are cached in a tensor —
this means CLIP inference at runtime only requires a single forward pass
through the vision encoder.

### 2b. Signal weights

Default: `{ml: 0.55, clip: 0.28, nlp: 0.17}`

Loaded from the `model_signal_weights` PostgreSQL table at startup.
Weights are redistributed automatically when a signal is unavailable
(e.g. no image provided → clip weight redistributed to ml + nlp).

### 2c. Fusion formula

$$\hat{h} = \arg\max_h \; \sum_{s \in \text{signals}} w_s \cdot \log p_s(h)$$

This weighted log-probability sum is the Bayesian model average in log space,
which numerically is equivalent to the geometric mean of probabilities.

### 2d. REST endpoint

The Python service exposes `/predict/multimodal` via the FastAPI router
(defined in `app/routers/predictions.py`).

The TypeScript `fusionEngineV2.ts` uses this endpoint internally:

```
POST http://ai-engine:8001/predict/multimodal
{
  "ml_features":  { … },
  "image_base64": "…",
  "report_text":  "flooding on high street"
}
```

---

## 3. Evaluation

### Benchmark your CLIP model

**Script:** `scripts/evaluation/clip_benchmark_v2.py`

Runs three variants on the 42-image AEGIS holdout set and
prints a confusion matrix for the fine-tuned checkpoint.

```bash
python scripts/evaluation/clip_benchmark_v2.py
# → reports/clip_benchmark_v2.csv
# → reports/clip_confusion_matrix.pdf
```

### Benchmark the full fusion pipeline

**Script:** `scripts/evaluation/fusion_benchmark.py`

Runs 50 synthetic incidents through all signal combinations and measures:
- Accuracy per hazard
- Latency (p50, p95, p99)
- ECE calibration score

```bash
python scripts/evaluation/fusion_benchmark.py --cases 100
# → reports/fusion_benchmark.csv
# → reports/fusion_calibration.pdf
```

---

## 4. Adding new image datasets

1. Place images in `data/crisis/<dataset_name>/images/`
2. Create `data/crisis/<dataset_name>/annotations.csv` with columns:
   `image_path, class_label, text_caption`
   (text_caption can be empty for image-only datasets)
3. Add a `elif` branch in `CrisisDataset.__init__()` in `finetune_clip.py`
4. Re-run `finetune_clip.py` from epoch 1 or fine-tune from the last checkpoint
   by setting `--resume model_registry/clip/clip_crisis_vit_b32.pt`

For damage severity datasets, apply the same process in
`finetune_clip_damage_severity.py` (look for `CLIPSeverityDataset`).

---

## 5. Hardware requirements

| Task | VRAM | Time (RTX 2060 SUPER) |
|---|---|---|
| CLIP fine-tuning (FP16, batch 32) | ~5 GB | ~4 hours |
| Damage severity head (FP16, batch 64) | ~3 GB | ~2 hours |
| Inference (single image) | ~1.5 GB | <100 ms |
| CPU inference (no GPU) | — | ~1–2 s |

All training scripts auto-detect CUDA and fall back to CPU.
FP16 (`torch.cuda.amp.autocast`) is only used on CUDA devices.

---

## 6. Model registry layout

```
model_registry/
└── clip/
    ├── clip_crisis_vit_b32.pt          ← Phase 1 crisis classifier weights
    ├── clip_crisis_vit_b32.json        ← metadata (accuracy, epoch, date)
    ├── clip_damage_severity_vit_b32.pt ← Phase 2 severity head weights
    └── clip_damage_severity_vit_b32.json
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `RuntimeError: CUDA out of memory` | Batch size too large | Reduce `--batch` to 16 |
| `KeyError: 'clip_crisis_vit_b32'` | Model file missing | Run `finetune_clip.py` first |
| CLIP accuracy stuck at ~52% | Text encoder fine-tuned | Set `clip.transformer.requires_grad_(False)` |
| Damage severity all `no_damage` | Class weights wrong | Check `build_class_weights()` in finetune_clip_damage_severity.py |
| Fusion returns `unknown` | No signal threshold met | Lower `MIN_CONFIDENCE` in multimodal_fusion.py (default 0.15) |
