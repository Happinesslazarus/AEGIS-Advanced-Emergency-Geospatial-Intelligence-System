"""
Clip_fewshot AI engine module.
"""

import json
import os
import sys
import time
import argparse
from pathlib import Path
from collections import defaultdict

import numpy as np
import torch
import open_clip
from PIL import Image
import torchvision.transforms as T

# Configuration

CATEGORIES = [
    "wildfire", "flood", "earthquake", "storm", "landslide",
    "drought", "structural_damage", "heatwave", "safe"
]

# Cross-category aliases for evaluation
TYPE_ALIASES = {
    "wildfire": {"wildfire"},
    "flood": {"flood"},
    "earthquake": {"earthquake", "structural_damage"},
    "storm": {"storm"},
    "landslide": {"landslide"},
    "drought": {"drought", "heatwave"},
    "structural_damage": {"structural_damage", "earthquake"},
    "heatwave": {"heatwave", "drought"},
    "safe": {"safe"},
}

def load_clip_model(model_name="ViT-B-32", device=None):
    """Load CLIP model for feature extraction."""
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"Loading CLIP model: {model_name} on {device}...", flush=True)
    model, _, preprocess = open_clip.create_model_and_transforms(
        model_name, pretrained="openai", device=device
    )
    model.eval()
    print(f"CLIP model loaded ({model_name})", flush=True)
    return model, preprocess, device

def extract_embedding(model, preprocess, image_path, device):
    """Extract normalized CLIP embedding for a single image."""
    image = Image.open(image_path).convert("RGB")
    image_input = preprocess(image).unsqueeze(0).to(device)
    with torch.no_grad():
        features = model.encode_image(image_input)
        features /= features.norm(dim=-1, keepdim=True)
    return features.squeeze(0).cpu().numpy()

def extract_augmented_embeddings(model, preprocess, image_path, device, n_aug=10):
    """Extract embeddings for augmented versions of an image."""
    image = Image.open(image_path).convert("RGB")

    # Augmentation transforms (applied BEFORE CLIP preprocessing)
    augment = T.Compose([
        T.RandomResizedCrop(224, scale=(0.7, 1.0), ratio=(0.8, 1.2)),
        T.RandomHorizontalFlip(p=0.5),
        T.RandomRotation(15),
        T.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1),
        T.RandomGrayscale(p=0.1),
    ])

    embeddings = []
    # Always include the original
    orig_input = preprocess(image).unsqueeze(0).to(device)
    with torch.no_grad():
        orig_feat = model.encode_image(orig_input)
        orig_feat /= orig_feat.norm(dim=-1, keepdim=True)
        embeddings.append(orig_feat.squeeze(0).cpu().numpy())

    # Add augmented versions
    for _ in range(n_aug):
        aug_img = augment(image)
        aug_input = preprocess(aug_img).unsqueeze(0).to(device)
        with torch.no_grad():
            aug_feat = model.encode_image(aug_input)
            aug_feat /= aug_feat.norm(dim=-1, keepdim=True)
            embeddings.append(aug_feat.squeeze(0).cpu().numpy())

    return np.array(embeddings)

def is_type_match(predicted, expected):
    """Check if predicted type matches expected, including aliases."""
    pred_lower = predicted.lower().strip()
    exp_lower = expected.lower().strip()
    if pred_lower == exp_lower:
        return True
    aliases = TYPE_ALIASES.get(exp_lower, set())
    return pred_lower in aliases

def prototype_classify(test_embedding, prototypes):
    """Classify by nearest prototype (cosine similarity)."""
    best_cat = None
    best_sim = -1.0
    all_sims = {}

    for cat, proto in prototypes.items():
        sim = float(np.dot(test_embedding, proto))
        all_sims[cat] = sim
        if sim > best_sim:
            best_sim = sim
            best_cat = cat

    # Convert to probabilities via softmax
    sims_array = np.array([all_sims[c] for c in CATEGORIES])
    # Temperature-scaled softmax
    temp = 0.05
    exp_sims = np.exp((sims_array - sims_array.max()) / temp)
    probs = exp_sims / exp_sims.sum()
    results = [(CATEGORIES[i], float(probs[i])) for i in range(len(CATEGORIES))]
    results.sort(key=lambda x: x[1], reverse=True)

    return results

def run_loo_benchmark(model_name="ViT-B-32", use_augmentation=False, n_aug=10):
    """
    Leave-one-out cross-validation benchmark.
    For each of the 42 images, build prototypes from remaining 41, classify the held-out image.
    """
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
    print(f"Loaded {total} benchmark images", flush=True)

    # Load model
    model, preprocess, device = load_clip_model(model_name)

    # Step 1: Extract all embeddings
    print(f"\nExtracting embeddings for {total} images...", flush=True)
    all_data = []  # (img_data, embedding, img_path)

    for i, img_data in enumerate(images):
        img_id = img_data["id"]
        img_file = upload_base / f"{img_id}.jpg"
        if not img_file.exists():
            img_file = upload_base / f"{img_id}.png"
        if not img_file.exists():
            local_path = img_data.get("local_path", "")
            alt = script_dir.parent / "server" / local_path.lstrip("/")
            if alt.exists():
                img_file = alt

        if not img_file.exists():
            print(f"  SKIP {img_id}: not found")
            continue

        if use_augmentation:
            embeddings = extract_augmented_embeddings(
                model, preprocess, img_file, device, n_aug=n_aug
            )
            all_data.append((img_data, embeddings, img_file))
        else:
            embedding = extract_embedding(model, preprocess, img_file, device)
            all_data.append((img_data, embedding, img_file))

        if (i + 1) % 10 == 0:
            print(f"  Extracted {i+1}/{total}", flush=True)

    print(f"  Extracted all {len(all_data)} embeddings", flush=True)

    # Step 2: Leave-one-out evaluation
    mode = "augmented" if use_augmentation else "prototype"
    print(f"\n{'='*60}")
    print(f"  AEGIS CLIP Few-Shot Benchmark ({mode}) - {len(all_data)} images")
    print(f"  Model: {model_name} | Device: {device}")
    print(f"  Evaluation: Leave-One-Out Cross-Validation")
    if use_augmentation:
        print(f"  Augmentations per image: {n_aug}")
    print(f"  Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    correct = 0
    results = []
    category_stats = defaultdict(lambda: {"total": 0, "correct": 0, "preds": []})

    for i, (test_data, test_emb, test_path) in enumerate(all_data):
        test_id = test_data["id"]
        expected_type = test_data["expected_type"]
        expected_severity = test_data.get("expected_severity", "unknown")
        description = test_data.get("description", "")

        # Build prototypes from all OTHER images
        prototypes = defaultdict(list)
        for j, (train_data, train_emb, _) in enumerate(all_data):
            if j == i:
                continue  # Skip test image

            cat = train_data["expected_type"]
            if use_augmentation:
                # train_emb is (n_aug+1, dim) array
                for emb in train_emb:
                    prototypes[cat].append(emb)
            else:
                prototypes[cat].append(train_emb)

        # Average embeddings per category to create prototypes
        avg_prototypes = {}
        for cat, embs in prototypes.items():
            avg = np.mean(embs, axis=0)
            avg /= np.linalg.norm(avg)
            avg_prototypes[cat] = avg

        # Classify the held-out image
        start = time.time()
        if use_augmentation:
            # Use original (first) embedding for testing
            test_embedding = test_emb[0]
        else:
            test_embedding = test_emb

        preds = prototype_classify(test_embedding, avg_prototypes)
        elapsed = int((time.time() - start) * 1000)

        pred_type = preds[0][0]
        pred_prob = preds[0][1]
        confidence = int(pred_prob * 100)

        type_correct = is_type_match(pred_type, expected_type)
        if type_correct:
            correct += 1
            icon = "\u2705"
        else:
            icon = "\u274c"

        category_stats[expected_type]["total"] += 1
        if type_correct:
            category_stats[expected_type]["correct"] += 1
        else:
            category_stats[expected_type]["preds"].append(pred_type)

        top3 = ", ".join([f"{c}:{p:.1%}" for c, p in preds[:3]])
        print(
            f"[{i+1}/{len(all_data)}] {test_id}: {description[:45]:45s} "
            f"{icon} pred={pred_type} exp={expected_type} "
            f"conf={confidence}%  [{top3}]",
            flush=True,
        )

        results.append({
            "id": test_id,
            "status": "ok",
            "expected_type": expected_type,
            "predicted_type": pred_type,
            "predicted_confidence": confidence,
            "type_correct": type_correct,
            "top_predictions": [{"type": c, "prob": round(p, 4)} for c, p in preds],
        })

    # Summary
    evaluated = len(results)
    accuracy = (correct / evaluated * 100) if evaluated > 0 else 0

    print(f"\n{'='*60}")
    print(f"  RESULTS SUMMARY")
    print(f"{'='*60}")
    print(f"  Method:              CLIP Few-Shot ({mode})")
    print(f"  Model:               {model_name}")
    print(f"  Type Accuracy:       {accuracy:.1f}%  ({correct}/{evaluated})")
    print(f"\n  Per-category breakdown:")

    for cat in sorted(category_stats):
        info = category_stats[cat]
        pct = 100 * info["correct"] / info["total"] if info["total"] > 0 else 0
        bar = "\u2588" * int(pct / 5) + "\u2591" * (20 - int(pct / 5))
        misses = ", ".join(info["preds"]) if info["preds"] else ""
        print(f"    {cat:20s} {bar} {pct:5.1f}%  ({info['correct']}/{info['total']})"
              + (f"  miss: [{misses}]" if misses else ""))

    print(f"{'='*60}\n")

    # Save report
    reports_dir = script_dir / "reports"
    reports_dir.mkdir(exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    report_path = reports_dir / f"clip_fewshot_{timestamp}.json"

    report = {
        "method": f"clip_fewshot_{mode}",
        "model": model_name,
        "device": device,
        "total": total,
        "evaluated": evaluated,
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
    """Classify a single image using all benchmark images as prototypes."""
    script_dir = Path(__file__).resolve().parent.parent
    benchmark_path = script_dir / "data" / "vision_benchmark.json"
    upload_base = script_dir.parent / "server" / "uploads" / "chat" / "benchmark"

    with open(benchmark_path) as f:
        benchmark = json.load(f)
    images_data = benchmark.get("benchmark", [])

    model, preprocess, device = load_clip_model(model_name)

    # Build prototypes from all benchmark images
    prototypes = defaultdict(list)
    for img_data in images_data:
        img_id = img_data["id"]
        img_file = upload_base / f"{img_id}.jpg"
        if not img_file.exists():
            img_file = upload_base / f"{img_id}.png"
        if not img_file.exists():
            continue

        emb = extract_embedding(model, preprocess, img_file, device)
        prototypes[img_data["expected_type"]].append(emb)

    avg_prototypes = {}
    for cat, embs in prototypes.items():
        avg = np.mean(embs, axis=0)
        avg /= np.linalg.norm(avg)
        avg_prototypes[cat] = avg

    # Classify
    test_emb = extract_embedding(model, preprocess, image_path, device)
    preds = prototype_classify(test_emb, avg_prototypes)

    print(f"\nClassification results for: {image_path}")
    print("-" * 50)
    for cat, prob in preds:
        bar = "\u2588" * int(prob * 40) + "\u2591" * (40 - int(prob * 40))
        print(f"  {cat:20s} {bar} {prob:6.1%}")
    print(f"\n  Prediction: {preds[0][0]} ({preds[0][1]:.1%} confidence)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS CLIP Few-Shot Classifier")
    parser.add_argument("--model", default="ViT-B-32",
                        help="CLIP model name (default: ViT-B-32)")
    parser.add_argument("--augment", action="store_true",
                        help="Use data augmentation for prototypes")
    parser.add_argument("--n-aug", type=int, default=10,
                        help="Number of augmentations per image (default: 10)")
    parser.add_argument("--single", type=str, default=None,
                        help="Classify a single image file")
    args = parser.parse_args()

    if args.single:
        classify_single(args.single, args.model)
    else:
        run_loo_benchmark(args.model, use_augmentation=args.augment, n_aug=args.n_aug)
