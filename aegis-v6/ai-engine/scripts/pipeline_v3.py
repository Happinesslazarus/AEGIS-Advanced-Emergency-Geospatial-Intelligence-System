"""
Pipeline_v3 AI engine module.
"""

import json
import sys
import time
import base64
import argparse
import requests
from pathlib import Path
from collections import defaultdict

import torch
import open_clip
from PIL import Image

# Configuration

OLLAMA_URL = "http://localhost:11434/api/generate"
MOONDREAM_MODEL = "moondream:latest"
GEMMA_MODEL = "gemma3:4b"

CATEGORIES = [
    "wildfire", "flood", "earthquake", "storm", "landslide",
    "drought", "structural_damage", "heatwave", "safe"
]

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

# Layer 1: Moondream Descriptor

def moondream_describe(image_path, timeout=60):
    """Get a natural language description of the image from moondream."""
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "model": MOONDREAM_MODEL,
        "prompt": "Describe what you see in this image in one sentence.",
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 60},
    }

    start = time.time()
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        raw = resp.json().get("response", "").strip()
        elapsed = int((time.time() - start) * 1000)
        return raw, elapsed
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return f"ERROR: {e}", elapsed

# Layer 2: CLIP Classifier

class CLIPClassifier:
    def __init__(self, device=None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[CLIP] Loading ViT-B-32 on {self.device}...", flush=True)
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="openai", device=self.device
        )
        self.tokenizer = open_clip.get_tokenizer("ViT-B-32")
        self.model.eval()
        self._build_embeddings()
        print("[CLIP] Ready", flush=True)

    def _build_embeddings(self):
        self.text_embeddings = {}
        with torch.no_grad():
            for cat, prompts in PROMPT_TEMPLATES.items():
                tokens = self.tokenizer(prompts).to(self.device)
                feats = self.model.encode_text(tokens)
                feats /= feats.norm(dim=-1, keepdim=True)
                avg = feats.mean(dim=0)
                avg /= avg.norm()
                self.text_embeddings[cat] = avg

    def classify(self, image_path):
        image = Image.open(image_path).convert("RGB")
        img_tensor = self.preprocess(image).unsqueeze(0).to(self.device)
        with torch.no_grad():
            img_feats = self.model.encode_image(img_tensor)
            img_feats /= img_feats.norm(dim=-1, keepdim=True)
        cat_embs = torch.stack([self.text_embeddings[c] for c in CATEGORIES])
        sims = (img_feats @ cat_embs.T).squeeze(0)
        probs = torch.softmax(sims / 0.01, dim=0)
        results = [(CATEGORIES[i], float(probs[i])) for i in range(len(CATEGORIES))]
        results.sort(key=lambda x: x[1], reverse=True)
        return results

# Layer 3: Gemma3 Reasoning

def gemma3_reason(description, clip_type, clip_confidence, clip_top3, timeout=30):
    """
    Gemma3 receives CLIP classification + moondream description.
    Returns final classification based on reasoning.
    """
    top3_str = ", ".join([f"{c} ({p:.1%})" for c, p in clip_top3[:3]])

    prompt = f"""You are a disaster image classification expert for the AEGIS emergency system.

IMAGE DESCRIPTION (from vision model): "{description}"

CLIP CLASSIFIER RESULT:
- Top prediction: {clip_type} (confidence: {clip_confidence:.1%})
- Top 3: {top3_str}

YOUR TASK: Based on the image description and CLIP's predictions, determine the correct disaster type.

DECISION RULES:
1. If the description mentions fire, flames, burning, smoke from fire -> wildfire
2. If the description mentions water covering, flooding, submerged -> flood
3. If the description mentions collapsed, rubble, destroyed buildings -> earthquake or structural_damage
4. If the description mentions storm, lightning, dark clouds, tornado, hurricane -> storm
5. If the description mentions mudslide, landslide, earth sliding -> landslide
6. If the description mentions dry, cracked earth, dead crops, empty riverbed -> drought
7. If the description mentions damaged buildings, bridge failure, structural collapse -> structural_damage
8. If the description mentions heat, scorching, sun-baked -> heatwave
9. If the description mentions normal scene, house, park, people doing everyday things -> safe
10. If CLIP confidence is high (>80%) and matches the description, trust CLIP.
11. If CLIP confidence is low (<50%) but the description clearly indicates a specific disaster, trust the description.

Valid types: wildfire, flood, earthquake, storm, landslide, drought, structural_damage, heatwave, safe

Respond with ONLY this format:
TYPE: <disaster_type>"""

    payload = {
        "model": GEMMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 30},
    }

    start = time.time()
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        raw = resp.json().get("response", "").strip()
        elapsed = int((time.time() - start) * 1000)

        final_type = clip_type  # Default to CLIP
        for line in raw.split("\n"):
            ls = line.strip()
            if ls.upper().startswith("TYPE:"):
                parsed = ls[5:].strip().lower().replace(" ", "_")
                for cat in CATEGORIES:
                    if cat == parsed or cat in parsed or parsed in cat:
                        final_type = cat
                        break
                break

        return final_type, raw, elapsed
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return clip_type, f"ERROR: {e}", elapsed

# Helpers

def is_type_match(predicted, expected):
    p, e = predicted.lower().strip(), expected.lower().strip()
    return p == e or p in TYPE_ALIASES.get(e, set())

# Main Pipeline

def run_pipeline(skip_gemma=False):
    script_dir = Path(__file__).resolve().parent.parent
    benchmark_path = script_dir / "data" / "vision_benchmark.json"
    upload_base = script_dir.parent / "server" / "uploads" / "chat" / "benchmark"

    with open(benchmark_path) as f:
        images = json.load(f).get("benchmark", [])
    total = len(images)
    print(f"\nLoaded {total} benchmark images")

    # Resolve image paths
    img_paths = {}
    for img_data in images:
        img_id = img_data["id"]
        for ext in [".jpg", ".png"]:
            p = upload_base / f"{img_id}{ext}"
            if p.exists():
                img_paths[img_id] = p
                break
        if img_id not in img_paths:
            alt = script_dir.parent / "server" / img_data.get("local_path", "").lstrip("/")
            if alt.exists():
                img_paths[img_id] = alt

    print(f"Found {len(img_paths)}/{total} images\n")

    # PHASE 1: Moondream descriptions (BEFORE loading CLIP on GPU)
    print("=" * 70)
    print("  PHASE 1: Moondream Image Descriptions")
    print("=" * 70)

    desc_cache = {}
    for i, img_data in enumerate(images):
        img_id = img_data["id"]
        if img_id not in img_paths:
            continue
        desc, ms = moondream_describe(img_paths[img_id])
        desc_cache[img_id] = (desc, ms)
        print(f"  [{i+1:2d}/{total}] {img_id}: ({ms}ms) {desc[:80]}", flush=True)

    print(f"\n  Described {len(desc_cache)} images\n")

    # PHASE 2: CLIP Classification
    print("=" * 70)
    print("  PHASE 2: CLIP Classification")
    print("=" * 70)
    clip = CLIPClassifier()

    clip_cache = {}
    for img_data in images:
        img_id = img_data["id"]
        if img_id not in img_paths:
            continue
        clip_cache[img_id] = clip.classify(img_paths[img_id])

    print(f"  Classified {len(clip_cache)} images\n")

    # PHASE 3: Gemma3 Reasoning + Scoring
    layers = "L1(Moondream-desc) + L2(CLIP)"
    if not skip_gemma:
        layers += " + L3(Gemma3)"

    print("=" * 70)
    print(f"  PHASE 3: Decision ({layers})")
    print("=" * 70 + "\n")

    results = []
    correct = 0
    clip_only_correct = 0
    category_stats = defaultdict(lambda: {"total": 0, "correct": 0, "preds": []})

    for i, img_data in enumerate(images):
        img_id = img_data["id"]
        expected_type = img_data["expected_type"]

        if img_id not in img_paths:
            results.append({"id": img_id, "status": "skip"})
            continue

        desc, desc_ms = desc_cache[img_id]
        clip_results = clip_cache[img_id]
        clip_type = clip_results[0][0]
        clip_conf = clip_results[0][1]
        clip_top3 = clip_results[:3]

        # CLIP-only baseline
        if is_type_match(clip_type, expected_type):
            clip_only_correct += 1

        # Decision
        if skip_gemma:
            final_type = clip_type
            gemma_raw = "N/A"
            gemma_ms = 0
            decision = "L2:clip"
        else:
            final_type, gemma_raw, gemma_ms = gemma3_reason(
                desc, clip_type, clip_conf, clip_top3
            )
            decision = f"L3:gemma"

        type_correct = is_type_match(final_type, expected_type)
        if type_correct:
            correct += 1
            icon = "OK"
        else:
            icon = "XX"

        category_stats[expected_type]["total"] += 1
        if type_correct:
            category_stats[expected_type]["correct"] += 1
        else:
            category_stats[expected_type]["preds"].append(final_type)

        print(
            f"  [{i+1:2d}/{total}] {img_id:8s} {icon} "
            f"clip={clip_type:18s}({clip_conf:.0%}) "
            f"final={final_type:18s} exp={expected_type:18s} "
            f"[{decision}] desc: {desc[:50]}",
            flush=True,
        )

        results.append({
            "id": img_id,
            "expected_type": expected_type,
            "description": desc[:200],
            "description_ms": desc_ms,
            "clip_type": clip_type,
            "clip_confidence": round(clip_conf, 4),
            "clip_top3": [(c, round(p, 4)) for c, p in clip_top3],
            "final_type": final_type,
            "decision": decision,
            "correct": type_correct,
            "gemma_raw": gemma_raw[:200] if gemma_raw else "",
            "gemma_ms": gemma_ms,
        })

    # Summary
    scored = sum(1 for r in results if r.get("status") != "skip")
    accuracy = correct / scored if scored else 0
    clip_accuracy = clip_only_correct / scored if scored else 0
    delta = accuracy - clip_accuracy

    print(f"\n{'='*70}")
    print(f"  RESULTS — {layers}")
    print(f"{'='*70}")
    print(f"  Pipeline Accuracy:  {correct}/{scored} = {accuracy:.1%}")
    print(f"  CLIP-only Accuracy: {clip_only_correct}/{scored} = {clip_accuracy:.1%}")
    print(f"  Improvement:        {delta:+.1%} ({correct - clip_only_correct:+d} images)")

    print(f"\n  Per-Category Accuracy:")
    for cat in CATEGORIES:
        s = category_stats[cat]
        if s["total"] == 0:
            continue
        cat_acc = s["correct"] / s["total"]
        wrong = f"  wrong: {', '.join(s['preds'])}" if s["preds"] else ""
        print(f"    {cat:20s}: {s['correct']}/{s['total']} = {cat_acc:.0%}{wrong}")

    report = {
        "pipeline": "3-layer-v3-descriptor",
        "layers": layers,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "accuracy": round(accuracy, 4),
        "clip_only_accuracy": round(clip_accuracy, 4),
        "improvement": round(delta, 4),
        "correct": correct,
        "total": scored,
        "results": results,
    }

    report_path = script_dir / "reports" / "pipeline_benchmark_v3.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report saved: {report_path}")
    print(f"{'='*70}\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-gemma", action="store_true",
                        help="Skip Gemma3 reasoning (just CLIP + moondream descriptions)")
    args = parser.parse_args()
    run_pipeline(skip_gemma=args.skip_gemma)
