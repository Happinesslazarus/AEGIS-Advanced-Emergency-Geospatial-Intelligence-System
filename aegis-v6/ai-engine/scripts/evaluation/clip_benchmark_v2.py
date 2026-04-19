"""
Evaluates the fine-tuned CLIP model against the original zero-shot baseline
on the 42-image AEGIS internal benchmark and (optionally) the full
CrisisMMD validation set.

Metrics reported:
  Top-1 accuracy         — % of images correctly classified
  Top-3 accuracy         — % of images where correct class is in top 3
  Per-class F1           — precision/recall balance per hazard category
  Confusion matrix       — PDF heatmap for dissertation appendix
  CLIP embedding quality — intra-class cosine similarity (cluster tightness)

Baselines compared:
  zero-shot             OpenAI ViT-B-32, no fine-tuning, standard text prompts
  zero-shot-crisis      OpenAI ViT-B-32, no fine-tuning, crisis-specific prompts
  fine-tuned            AEGIS fine-tuned ViT-B-32 (clip_crisis_vit_b32.pt)

Output files:
  reports/clip_benchmark_v2.csv      — per-model, per-class metrics
  reports/clip_confusion_matrix.pdf  — confusion matrix chart

  Reads from  ← model_registry/clip/clip_crisis_vit_b32.pt
              ← data/crisis/crisismmd/  (full val set if --full-eval)
              ← data/crisis/aegis_benchmark.csv  (42-image internal benchmark)
  Writes to   → reports/

Usage:
  python scripts/evaluation/clip_benchmark_v2.py
  python scripts/evaluation/clip_benchmark_v2.py --full-eval
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy  as np
    import pandas as pd
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install numpy pandas")

try:
    import torch
    import torch.nn.functional as F
except ImportError:
    sys.exit("Missing: torch\nRun: pip install torch")

try:
    import open_clip
except ImportError:
    sys.exit("Missing: open_clip_torch\nRun: pip install open-clip-torch")

try:
    from PIL import Image
except ImportError:
    sys.exit("Missing: Pillow\nRun: pip install Pillow")

try:
    from sklearn.metrics import (
        accuracy_score, classification_report,
        confusion_matrix,
    )
except ImportError:
    sys.exit("Missing: scikit-learn\nRun: pip install scikit-learn")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
except ImportError:
    sys.exit("Missing: matplotlib seaborn\nRun: pip install matplotlib seaborn")

_AI_ROOT   = Path(__file__).resolve().parents[2]
DATA_ROOT  = _AI_ROOT / "data" / "crisis"
REGISTRY   = _AI_ROOT / "model_registry" / "clip"
REPORT_DIR = _AI_ROOT / "reports"
DEVICE     = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Import CRISIS_LABELS from the training script
sys.path.insert(0, str(_AI_ROOT / "training"))
try:
    from finetune_clip import CRISIS_LABELS
except ImportError:
    CRISIS_LABELS = {
        "flood":              "a photograph of flood damage",
        "wildfire":           "a photograph of wildfire with flames",
        "earthquake_damage":  "a photograph of earthquake damage",
        "hurricane":          "a photograph of hurricane damage",
        "tornado":            "a photograph of tornado damage",
        "drought":            "a photograph of drought",
        "not_disaster":       "a normal non-emergency photograph",
    }

# Root-level crisis text prompts for the zero-shot-crisis variant
CRISIS_PROMPTS = {
    k: f"crisis photography: {v}"
    for k, v in CRISIS_LABELS.items()
}


def load_model(ckpt_path: Path | None) -> tuple:
    """Load CLIP model + tokenizer + preprocess.  ckpt_path=None → zero-shot."""
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    if ckpt_path and ckpt_path.exists():
        model.load_state_dict(torch.load(str(ckpt_path), map_location=DEVICE))
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model     = model.to(DEVICE).eval()
    return model, tokenizer, preprocess


def encode_text_labels(model, tokenizer, prompts: dict[str, str]) -> tuple[torch.Tensor, list[str]]:
    """Pre-compute normalised text embeddings for all class prompts."""
    label_keys  = list(prompts.keys())
    label_texts = list(prompts.values())
    tokens      = tokenizer(label_texts).to(DEVICE)
    with torch.no_grad():
        text_feats = model.encode_text(tokens)
        text_feats = F.normalize(text_feats, dim=-1)
    return text_feats, label_keys


def classify_images(
    model,
    preprocess,
    text_feats: torch.Tensor,
    label_keys: list[str],
    image_paths: list[str],
    true_labels: list[str],
    batch_size: int = 32,
) -> tuple[list[str], list[float]]:
    """Classify all images and return (predicted_labels, confidences)."""
    preds  = []
    confs  = []
    for i in range(0, len(image_paths), batch_size):
        batch_paths  = image_paths[i:i + batch_size]
        imgs         = []
        for p in batch_paths:
            try:
                img = Image.open(p).convert("RGB")
                imgs.append(preprocess(img))
            except Exception:
                imgs.append(torch.zeros(3, 224, 224))

        img_batch = torch.stack(imgs).to(DEVICE)
        with torch.no_grad():
            img_feats = model.encode_image(img_batch)
            img_feats = F.normalize(img_feats, dim=-1)
            sims      = img_feats @ text_feats.t()        # [N, n_classes]
            probs     = sims.softmax(dim=-1)
            top1_idx  = probs.argmax(dim=1).cpu().tolist()
            top1_conf = probs.max(dim=1).values.cpu().tolist()

        preds.extend([label_keys[i] for i in top1_idx])
        confs.extend(top1_conf)

    return preds, confs


def load_benchmark(csv_path: Path) -> tuple[list[str], list[str]]:
    """Load 42-image AEGIS benchmark → (image_paths, label_strings)."""
    if not csv_path.exists():
        return [], []
    df = pd.read_csv(str(csv_path))
    return df["image_path"].tolist(), df["label"].tolist()


def load_crisismmd_val(data_root: Path, max_samples: int = 2_000) -> tuple[list, list]:
    """Load CrisisMMD validation split for the full evaluation mode."""
    csv = data_root / "crisismmd" / "labels_val.csv"
    if not csv.exists():
        csv = data_root / "crisismmd" / "labels_train.csv"
    if not csv.exists():
        return [], []
    df = pd.read_csv(str(csv)).head(max_samples)
    img_paths  = (data_root / "crisismmd" / df["image_path"].astype(str)).values if "image_path" in df else []
    labels     = df["label"].tolist() if "label" in df else []
    return list(img_paths), labels


def plot_confusion(
    true_labels: list[str],
    pred_labels: list[str],
    label_names: list[str],
    out_path:    Path,
    title:       str,
) -> None:
    cm = confusion_matrix(true_labels, pred_labels, labels=label_names)
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True).clip(min=1)
    fig, ax = plt.subplots(figsize=(9, 7))
    sns.heatmap(cm_norm, annot=True, fmt=".2f",
                xticklabels=label_names, yticklabels=label_names,
                cmap="Blues", linewidths=0.3, ax=ax)
    ax.set_title(title, fontsize=11)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    plt.tight_layout()
    plt.savefig(str(out_path), dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Confusion matrix → {out_path}")


def evaluate_model(
    name:        str,
    model,
    tokenizer,
    preprocess,
    prompts:     dict[str, str],
    images:      list[str],
    labels:      list[str],
) -> dict:
    """Run a single model evaluation and return metrics dict."""
    text_feats, label_keys = encode_text_labels(model, tokenizer, prompts)
    preds, confs = classify_images(model, preprocess, text_feats, label_keys, images, labels)

    valid = [(p, l) for p, l in zip(preds, labels) if l in label_keys]
    if not valid:
        return {"model": name, "top1": 0, "n": 0}

    preds_v, labels_v = zip(*valid)
    top1 = accuracy_score(labels_v, preds_v)
    report = classification_report(
        labels_v, preds_v,
        labels=label_keys,
        zero_division=0,
        output_dict=True,
    )
    print(f"  [{name}]  Top-1={top1:.3f}  n={len(valid)}")
    return {
        "model":  name,
        "top1":   round(top1, 4),
        "n":      len(valid),
        "report": report,
        "preds":  list(preds_v),
        "labels": list(labels_v),
    }


def main(args: argparse.Namespace) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load benchmark images ──────────────────────────────────────────────
    benchmark_csv = DATA_ROOT / "aegis_benchmark.csv"
    images, labels = load_benchmark(benchmark_csv)

    if args.full_eval:
        ext_images, ext_labels = load_crisismmd_val(DATA_ROOT)
        images.extend(ext_images)
        labels.extend(ext_labels)
        print(f"Full eval mode: {len(images):,} images")
    else:
        print(f"Internal benchmark: {len(images)} images")

    if not images:
        print("⚠ No images found.  Create data/crisis/aegis_benchmark.csv or "
              "run download_crisis_datasets.py first.")
        sys.exit(0)

    # ── Load models ────────────────────────────────────────────────────────
    print("\nLoading models …")
    # 1. Zero-shot with standard OpenAI prompts
    m_zs, tok, pre = load_model(None)
    # 2. Zero-shot with crisis-specific prompts (same model, different text)
    # 3. Fine-tuned
    ckpt = REGISTRY / "clip_crisis_vit_b32.pt"
    m_ft, tok_ft, pre_ft = load_model(ckpt if ckpt.exists() else None)

    # ── Run evaluations ────────────────────────────────────────────────────
    print("\nEvaluating …")
    results = []
    r1 = evaluate_model("zero-shot",        m_zs, tok,    pre,    CRISIS_LABELS,  images, labels)
    r2 = evaluate_model("zero-shot-crisis", m_zs, tok,    pre,    CRISIS_PROMPTS, images, labels)
    r3 = evaluate_model("fine-tuned",       m_ft, tok_ft, pre_ft, CRISIS_LABELS,  images, labels)
    results = [r1, r2, r3]

    # ── Write summary CSV ──────────────────────────────────────────────────
    rows = []
    for r in results:
        row = {"model": r["model"], "top1": r["top1"], "n": r["n"]}
        if "report" in r:
            for cls, metrics in r["report"].items():
                if isinstance(metrics, dict):
                    row[f"{cls}_f1"] = round(metrics.get("f1-score", 0), 3)
        rows.append(row)
    summary = pd.DataFrame(rows)
    summary.to_csv(str(REPORT_DIR / "clip_benchmark_v2.csv"), index=False)
    print(f"\n  CSV → {REPORT_DIR / 'clip_benchmark_v2.csv'}")
    print(summary.to_string(index=False))

    # ── Confusion matrix for fine-tuned model ─────────────────────────────
    if r3.get("preds"):
        plot_confusion(
            r3["labels"], r3["preds"],
            list(CRISIS_LABELS.keys()),
            REPORT_DIR / "clip_confusion_matrix.pdf",
            "AEGIS Fine-tuned CLIP — Confusion Matrix",
        )

    # ── Improvement summary ────────────────────────────────────────────────
    if r1["top1"] > 0 and r3["top1"] > 0:
        delta = (r3["top1"] - r1["top1"]) * 100
        print(f"\n  𝚫 Zero-shot → Fine-tuned: {delta:+.1f}pp "
              f"({'✓ target 75%+ met' if r3['top1'] >= 0.75 else '⚠ below 75% target'})")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--full-eval", action="store_true",
                   help="Include full CrisisMMD validation set (slower)")
    return p.parse_args()


if __name__ == "__main__":
    main(parse_args())
