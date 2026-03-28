"""
AEGIS Vision — CLIP Zero-Shot Disaster Image Classifier & Benchmark
Uses OpenAI CLIP (via open_clip) to classify disaster images zero-shot.
No training needed — CLIP understands disaster concepts from pre-training
on 400M+ image-text pairs.

Usage:
    python scripts/clip_benchmark.py                    # Run benchmark
    python scripts/clip_benchmark.py --model ViT-B-16   # Use larger model
    python scripts/clip_benchmark.py --single path.jpg  # Classify one image
"""

import json
import os
import sys
import time
import argparse
from pathlib import Path
from collections import defaultdict

import torch
import open_clip
from PIL import Image

# Configuration

# 9 disaster categories matching AEGIS benchmark
CATEGORIES = [
    "wildfire", "flood", "earthquake", "storm", "landslide",
    "drought", "structural_damage", "heatwave", "safe"
]

# CLIP text prompts — engineered for disaster classification
# Multiple prompts per category improve accuracy via prompt ensembling
PROMPT_TEMPLATES = {
    "wildfire": [
        "a photo of active flames and fire burning trees and vegetation",
        "a photo of a wildfire with visible orange flames and thick smoke",
        "a photo of a forest engulfed in fire with smoke rising",
        "a photo of burning hillside with fire and glowing embers",
        "aerial view of an active wildfire spreading through a landscape",
    ],
    "flood": [
        "a photo of deep brown murky water covering streets from flooding",
        "a photo of buildings partially submerged in flood water",
        "a photo of cars and vehicles submerged in rising flood water",
        "a photo of an overflowing river flooding the surrounding area",
        "a photo of a flooded residential neighborhood with water everywhere",
    ],
    "earthquake": [
        "a photo of collapsed concrete buildings from an earthquake",
        "a photo of pancaked floors and rubble from seismic destruction",
        "a photo of cracked walls and tilted buildings after an earthquake",
        "a photo of earthquake rubble with rebar and broken concrete",
        "a photo of a destroyed city block after a major earthquake",
    ],
    "storm": [
        "a photo of a severe thunderstorm with dark ominous clouds",
        "a photo of lightning striking during a violent storm",
        "a photo of a tornado funnel cloud touching the ground",
        "a photo of hurricane wind damage with uprooted trees",
        "a photo of dark storm clouds and heavy rain",
    ],
    "landslide": [
        "a photo of a mudslide with earth and rocks sliding down a hill",
        "a photo of a landslide blocking a road with displaced soil",
        "a photo of a collapsed hillside with exposed brown earth",
        "a photo of debris flow of mud and rocks down a mountainside",
        "a photo of terrain failure with soil and vegetation sliding downhill",
    ],
    "drought": [
        "a photo of severely cracked dry earth with deep fissures from drought",
        "a photo of a dried up empty riverbed or lake bed",
        "a photo of dead brown crops on a barren farm from drought",
        "a photo of dry barren terrain with no water and no green vegetation",
        "a photo of cracked dried mud flats from prolonged water shortage",
    ],
    "structural_damage": [
        "a photo of a partially collapsed building with broken walls",
        "a photo of a damaged bridge or overpass that has failed",
        "a photo of building rubble with exposed steel and broken concrete",
        "a photo of a roof caved in on a damaged house or structure",
        "a photo of structural failure with leaning walls and debris",
    ],
    "heatwave": [
        "a photo of visible heat shimmer and haze rising from hot pavement",
        "a photo of harsh glaring sun over a heat-scorched landscape",
        "a photo of heat distortion waves in the air over a road",
        "a photo of a sun-bleached landscape with intense bright sunlight",
        "a photo of shimmering heat haze over dry hot terrain",
    ],
    "safe": [
        "a photo of a beautiful normal day with clear blue sky and green trees",
        "a photo of a clean well-maintained city street with no damage",
        "a photo of intact buildings and a peaceful residential neighborhood",
        "a photo of a calm lake or river with undamaged scenery",
        "a photo of people in a normal everyday outdoor setting with no hazards",
    ],
}

# Cross-category aliases for evaluation (earthquake ↔ structural_damage, etc.)
TYPE_ALIASES = {
    "wildfire": {"wildfire", "fire", "bushfire", "forest_fire"},
    "flood": {"flood", "flooding", "flash_flood", "inundation"},
    "earthquake": {"earthquake", "seismic", "quake", "structural_damage",
                   "infrastructure_damage", "collapse"},
    "storm": {"storm", "severe_storm", "hurricane", "cyclone", "tornado",
              "typhoon", "wind_damage", "thunderstorm"},
    "landslide": {"landslide", "mudslide", "debris_flow", "slope_failure"},
    "drought": {"drought", "arid", "water_shortage", "heatwave",
                "heat_wave", "extreme_heat"},
    "structural_damage": {"structural_damage", "infrastructure_damage",
                          "collapse", "bridge_collapse", "earthquake",
                          "seismic", "quake"},
    "heatwave": {"heatwave", "heat_wave", "extreme_heat", "drought",
                 "arid", "water_shortage"},
    "safe": {"safe", "none", "no_hazard", "normal", "unknown"},
}

# Severity levels for confidence mapping
SEVERITY_THRESHOLDS = {
    "critical": 0.45,
    "high": 0.30,
    "moderate": 0.20,
    "low": 0.10,
    "none": 0.0,
}

def load_clip_model(model_name="ViT-B-32", device=None):
    """Load CLIP model and preprocessing transforms."""
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"Loading CLIP model: {model_name} on {device}...", flush=True)
    model, _, preprocess = open_clip.create_model_and_transforms(
        model_name, pretrained="openai", device=device
    )
    tokenizer = open_clip.get_tokenizer(model_name)
    model.eval()
    print(f"CLIP model loaded ({model_name})", flush=True)
    return model, preprocess, tokenizer, device

def build_text_embeddings(model, tokenizer, device):
    """
    Pre-compute averaged text embeddings for each disaster category.
    Uses prompt ensembling: multiple descriptions per category → averaged embedding.
    """
    category_embeddings = {}
    with torch.no_grad():
        for cat, prompts in PROMPT_TEMPLATES.items():
            tokens = tokenizer(prompts).to(device)
            text_features = model.encode_text(tokens)
            text_features /= text_features.norm(dim=-1, keepdim=True)
            # Average across all prompts for this category
            avg_embedding = text_features.mean(dim=0)
            avg_embedding /= avg_embedding.norm()
            category_embeddings[cat] = avg_embedding
    return category_embeddings

def classify_image(model, preprocess, category_embeddings, image_path, device):
    """
    Classify a single image using CLIP zero-shot.
    Returns sorted list of (category, probability) tuples.
    """
    image = Image.open(image_path).convert("RGB")
    image_input = preprocess(image).unsqueeze(0).to(device)

    with torch.no_grad():
        image_features = model.encode_image(image_input)
        image_features /= image_features.norm(dim=-1, keepdim=True)

    # Compute cosine similarities
    similarities = {}
    cat_embeddings = torch.stack(list(category_embeddings.values()))
    cat_names = list(category_embeddings.keys())
    sims = (image_features @ cat_embeddings.T).squeeze(0)

    # Temperature-scaled softmax for calibrated probabilities
    temperature = 0.01  # Lower = sharper probabilities
    probs = torch.softmax(sims / temperature, dim=0)

    results = [(cat_names[i], float(probs[i])) for i in range(len(cat_names))]
    results.sort(key=lambda x: x[1], reverse=True)
    return results

def prob_to_severity(prob):
    """Convert probability to severity level."""
    for sev, threshold in SEVERITY_THRESHOLDS.items():
        if prob >= threshold:
            return sev
    return "none"

def is_type_match(predicted, expected):
    """Check if predicted type matches expected, including aliases."""
    pred_lower = predicted.lower().strip()
    exp_lower = expected.lower().strip()

    if pred_lower == exp_lower:
        return True

    aliases = TYPE_ALIASES.get(exp_lower, set())
    return pred_lower in aliases

def run_benchmark(model_name="ViT-B-32"):
    """Run CLIP zero-shot benchmark against all 42 labeled images."""
    script_dir = Path(__file__).resolve().parent.parent
    benchmark_path = script_dir / "data" / "vision_benchmark.json"
    upload_base = script_dir.parent / "server" / "uploads" / "chat" / "benchmark"

    if not benchmark_path.exists():
        print(f"ERROR: Benchmark file not found: {benchmark_path}")
        sys.exit(1)

    with open(benchmark_path) as f:
        benchmark = json.load(f)

    images = benchmark.get("benchmark", [])
    total = len(images)
    print(f"\nLoaded {total} benchmark images from {benchmark_path.name}")

    # Load model
    model, preprocess, tokenizer, device = load_clip_model(model_name)
    category_embeddings = build_text_embeddings(model, tokenizer, device)

    print(f"\n{'='*60}")
    print(f"  AEGIS CLIP Zero-Shot Benchmark — {total} images")
    print(f"  Model: {model_name} | Device: {device}")
    print(f"  Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    results = []
    correct = 0
    category_stats = defaultdict(lambda: {"total": 0, "correct": 0, "preds": []})

    for i, img_data in enumerate(images):
        img_id = img_data["id"]
        expected_type = img_data["expected_type"]
        expected_severity = img_data.get("expected_severity", "unknown")
        description = img_data.get("description", "")

        # Find image file
        local_path = img_data.get("local_path", "")
        img_file = upload_base / f"{img_id}.jpg"
        if not img_file.exists():
            img_file = upload_base / f"{img_id}.png"
        if not img_file.exists():
            # Try the local_path
            alt = script_dir.parent / "server" / local_path.lstrip("/")
            if alt.exists():
                img_file = alt

        if not img_file.exists():
            print(f"[{i+1}/{total}] {img_id}: SKIP (image not found: {img_file})")
            results.append({
                "id": img_id,
                "status": "error",
                "error": f"Image not found: {img_file}",
            })
            continue

        start = time.time()
        preds = classify_image(model, preprocess, category_embeddings, img_file, device)
        elapsed = int((time.time() - start) * 1000)

        pred_type = preds[0][0]
        pred_prob = preds[0][1]
        pred_severity = prob_to_severity(pred_prob)
        confidence = int(pred_prob * 100)

        # Check correctness
        type_correct = is_type_match(pred_type, expected_type)
        if type_correct:
            correct += 1
            icon = "[OK]"
        else:
            icon = "[FAIL]"

        category_stats[expected_type]["total"] += 1
        if type_correct:
            category_stats[expected_type]["correct"] += 1
        else:
            category_stats[expected_type]["preds"].append(pred_type)

        # Top-3 for analysis
        top3 = ", ".join([f"{c}:{p:.1%}" for c, p in preds[:3]])

        print(
            f"[{i+1}/{total}] {img_id}: {description[:45]:45s} "
            f"{icon} pred={pred_type}/{pred_severity} "
            f"exp={expected_type}/{expected_severity} "
            f"conf={confidence}% {elapsed}ms  [{top3}]",
            flush=True,
        )

        results.append({
            "id": img_id,
            "status": "ok",
            "expected_type": expected_type,
            "expected_severity": expected_severity,
            "predicted_type": pred_type,
            "predicted_severity": pred_severity,
            "predicted_confidence": confidence,
            "type_correct": type_correct,
            "elapsed_ms": elapsed,
            "top_predictions": [{"type": c, "prob": round(p, 4)} for c, p in preds],
        })

    # Summary
    evaluated = sum(1 for r in results if r["status"] == "ok")
    errors = sum(1 for r in results if r["status"] == "error")
    accuracy = (correct / evaluated * 100) if evaluated > 0 else 0

    print(f"\n{'='*60}")
    print(f"  RESULTS SUMMARY")
    print(f"{'='*60}")
    print(f"  Model:               {model_name}")
    print(f"  Type Accuracy:       {accuracy:.1f}%  ({correct}/{evaluated})")
    print(f"  Errors:              {errors}")
    print(f"  Avg Response Time:   {sum(r.get('elapsed_ms',0) for r in results if r['status']=='ok') // max(evaluated,1)}ms")
    print(f"\n  Per-category breakdown:")

    for cat in sorted(category_stats):
        info = category_stats[cat]
        pct = 100 * info["correct"] / info["total"] if info["total"] > 0 else 0
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        misses = ", ".join(info["preds"]) if info["preds"] else ""
        print(f"    {cat:20s} {bar} {pct:5.1f}%  ({info['correct']}/{info['total']})"
              + (f"  miss: [{misses}]" if misses else ""))

    print(f"{'='*60}\n")

    # Save report
    reports_dir = script_dir / "reports"
    reports_dir.mkdir(exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    report_path = reports_dir / f"clip_benchmark_{timestamp}.json"

    report = {
        "model": model_name,
        "device": device,
        "total": total,
        "evaluated": evaluated,
        "errors": errors,
        "type_accuracy": round(accuracy, 1),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "results": results,
        "category_stats": {
            cat: {
                "total": info["total"],
                "correct": info["correct"],
                "accuracy": round(100 * info["correct"] / info["total"], 1) if info["total"] > 0 else 0,
                "misclassified_as": info["preds"],
            }
            for cat, info in sorted(category_stats.items())
        },
    }

    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Report saved to: {report_path}")

    return accuracy, report

def classify_single(image_path, model_name="ViT-B-32"):
    """Classify a single image and print results."""
    model, preprocess, tokenizer, device = load_clip_model(model_name)
    category_embeddings = build_text_embeddings(model, tokenizer, device)

    preds = classify_image(model, preprocess, category_embeddings, image_path, device)

    print(f"\nClassification results for: {image_path}")
    print(f"""")
    for cat, prob in preds:
        bar = "█" * int(prob * 40) + "░" * (40 - int(prob * 40))
        print(f"  {cat:20s} {bar} {prob:6.1%}")
    print(f"\n  Prediction: {preds[0][0]} ({preds[0][1]:.1%} confidence)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS CLIP Vision Benchmark")
    parser.add_argument("--model", default="ViT-B-32",
                        help="CLIP model name (default: ViT-B-32)")
    parser.add_argument("--single", type=str, default=None,
                        help="Classify a single image file")
    args = parser.parse_args()

    if args.single:
        classify_single(args.single, args.model)
    else:
        run_benchmark(args.model)
