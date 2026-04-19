"""
Pipeline_benchmark AI engine module.
"""

import json
import os
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

# CLIP prompt templates (same as production image_classifier.py)
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

# Cross-category aliases for evaluation
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

# CLIP Layer

class CLIPClassifier:
    """CLIP ViT-B-32 zero-shot disaster classifier (Layer 2)."""

    def __init__(self, device=None):
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

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
        """Returns list of (category, probability) sorted by probability desc."""
        image = Image.open(image_path).convert("RGB")
        img_tensor = self.preprocess(image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            img_feats = self.model.encode_image(img_tensor)
            img_feats /= img_feats.norm(dim=-1, keepdim=True)

        cat_embs = torch.stack([self.text_embeddings[c] for c in CATEGORIES])
        sims = (img_feats @ cat_embs.T).squeeze(0)

        temperature = 0.01
        probs = torch.softmax(sims / temperature, dim=0)

        results = [(CATEGORIES[i], float(probs[i])) for i in range(len(CATEGORIES))]
        results.sort(key=lambda x: x[1], reverse=True)
        return results

# Moondream Layer (Ollama Vision)

def moondream_safety_gate(image_path, timeout=60):
    """
    Layer 1: Binary safe/unsafe classification using moondream vision.
    Returns: ("safe" | "unsafe", raw_response, elapsed_ms)
    """
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    prompt = (
        "Look at this image carefully. Is this scene showing a disaster, "
        "emergency, or dangerous situation? Or is this a normal safe scene?\n\n"
        "Answer with exactly one word: SAFE or UNSAFE"
    )

    payload = {
        "model": MOONDREAM_MODEL,
        "prompt": prompt,
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 20},
    }

    start = time.time()
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        raw = resp.json().get("response", "").strip()
        elapsed = int((time.time() - start) * 1000)

        # Parse response to safe/unsafe
        raw_lower = raw.lower()
        if "unsafe" in raw_lower or "danger" in raw_lower or "disaster" in raw_lower or "emergency" in raw_lower:
            return "unsafe", raw, elapsed
        elif "safe" in raw_lower or "normal" in raw_lower or "no" in raw_lower:
            return "safe", raw, elapsed
        else:
            # If unclear, default to unsafe (conservative -- let CLIP decide)
            return "unsafe", raw, elapsed
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return "unsafe", f"ERROR: {e}", elapsed

# Gemma3 Reasoning Layer

def gemma3_reason(moondream_result, clip_type, clip_confidence, clip_top3, timeout=30):
    """
    Layer 3: Gemma3 reasoning brain. Receives structured inputs (no images).
    Validates CLIP classification using moondream context.
    Returns: (final_type, explanation, elapsed_ms)
    """
    top3_str = ", ".join([f"{c} ({p:.1%})" for c, p in clip_top3[:3]])

    prompt = f"""You are a disaster classification validator for the AEGIS emergency system.

INPUTS:
- Safety Gate (moondream vision): {moondream_result.upper()}
- CLIP Classifier Top-1: {clip_type} (confidence: {clip_confidence:.1%})
- CLIP Top-3: {top3_str}

RULES:
1. If safety gate says SAFE and CLIP confidence for the disaster type is below 80%, the scene is likely SAFE.
2. If safety gate says UNSAFE, trust CLIP's top-1 disaster classification.
3. If CLIP confidence is very low (below 40%), consider if the #2 prediction is more appropriate.
4. Valid disaster types: wildfire, flood, earthquake, storm, landslide, drought, structural_damage, heatwave, safe

OUTPUT FORMAT (exactly this, nothing else):
TYPE: <disaster_type>
REASON: <one sentence explanation>"""

    payload = {
        "model": GEMMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 100},
    }

    start = time.time()
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        raw = resp.json().get("response", "").strip()
        elapsed = int((time.time() - start) * 1000)

        # Parse TYPE: <type> from response
        final_type = clip_type  # Default to CLIP if parsing fails
        explanation = raw

        for line in raw.split("\n"):
            line_stripped = line.strip()
            if line_stripped.upper().startswith("TYPE:"):
                parsed = line_stripped[5:].strip().lower()
                # Map to valid category
                for cat in CATEGORIES:
                    if cat in parsed or parsed in cat:
                        final_type = cat
                        break
            elif line_stripped.upper().startswith("REASON:"):
                explanation = line_stripped[7:].strip()

        return final_type, explanation, elapsed
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return clip_type, f"ERROR: {e}", elapsed

# Evaluation Helpers

def is_type_match(predicted, expected):
    pred_lower = predicted.lower().strip()
    exp_lower = expected.lower().strip()
    if pred_lower == exp_lower:
        return True
    aliases = TYPE_ALIASES.get(exp_lower, set())
    return pred_lower in aliases

def prob_to_severity(prob):
    if prob >= 0.45:
        return "critical"
    elif prob >= 0.30:
        return "high"
    elif prob >= 0.20:
        return "moderate"
    elif prob >= 0.10:
        return "low"
    return "none"

# Main Pipeline

def run_pipeline(skip_gemma=False):
    """Run the full 3-layer pipeline benchmark on all 42 images."""

    script_dir = Path(__file__).resolve().parent.parent
    benchmark_path = script_dir / "data" / "vision_benchmark.json"
    upload_base = script_dir.parent / "server" / "uploads" / "chat" / "benchmark"

    if not benchmark_path.exists():
        print(f"ERROR: {benchmark_path} not found")
        sys.exit(1)

    with open(benchmark_path) as f:
        benchmark = json.load(f)

    images = benchmark.get("benchmark", [])
    total = len(images)
    print(f"\nLoaded {total} benchmark images")

    # Load CLIP model (Layer 2)
    clip = CLIPClassifier()

    # Verify Ollama is running
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        models = [m["name"] for m in resp.json().get("models", [])]
        print(f"[Ollama] Available: {', '.join(models)}")
    except Exception as e:
        print(f"ERROR: Ollama not reachable: {e}")
        sys.exit(1)

    layers = "L1(Moondream) + L2(CLIP)"
    if not skip_gemma:
        layers += " + L3(Gemma3)"

    print(f"\n{'='*70}")
    print(f"  AEGIS 3-Layer Vision Pipeline Benchmark")
    print(f"  Layers: {layers}")
    print(f"  Images: {total}")
    print(f"  Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*70}\n")

    results = []
    correct = 0
    clip_only_correct = 0
    moondream_stats = {"safe_correct": 0, "safe_total": 0,
                       "unsafe_correct": 0, "unsafe_total": 0}
    category_stats = defaultdict(lambda: {"total": 0, "correct": 0, "preds": []})
    total_time_ms = 0

    for i, img_data in enumerate(images):
        img_id = img_data["id"]
        expected_type = img_data["expected_type"]
        expected_severity = img_data.get("expected_severity", "unknown")
        description = img_data.get("description", "")

        # Find image file
        img_file = upload_base / f"{img_id}.jpg"
        if not img_file.exists():
            img_file = upload_base / f"{img_id}.png"
        if not img_file.exists():
            alt = script_dir.parent / "server" / img_data.get("local_path", "").lstrip("/")
            if alt.exists():
                img_file = alt

        if not img_file.exists():
            print(f"[{i+1}/{total}] {img_id}: SKIP (not found)")
            results.append({"id": img_id, "status": "skip"})
            continue

        img_start = time.time()

        # Layer 1: Moondream Safety Gate
        safety, moon_raw, moon_ms = moondream_safety_gate(img_file)

        # Track moondream accuracy
        expected_safe = (expected_type == "safe")
        if expected_safe:
            moondream_stats["safe_total"] += 1
            if safety == "safe":
                moondream_stats["safe_correct"] += 1
        else:
            moondream_stats["unsafe_total"] += 1
            if safety == "unsafe":
                moondream_stats["unsafe_correct"] += 1

        # Layer 2: CLIP Classification
        clip_results = clip.classify(img_file)
        clip_type = clip_results[0][0]
        clip_conf = clip_results[0][1]
        clip_top3 = clip_results[:3]

        # Track CLIP-only accuracy for comparison
        if is_type_match(clip_type, expected_type):
            clip_only_correct += 1

        # Decision Logic
        if safety == "safe" and clip_conf < 0.80:
            # Moondream says safe AND CLIP isn't highly confident about a disaster
            # > classify as safe
            final_type = "safe"
            decision = "L1:safe+L2:low_conf"
            gemma_reason_text = "Skipped (safe gate)"
            gemma_ms = 0
        elif safety == "safe" and clip_type == "safe":
            # Both agree it's safe
            final_type = "safe"
            decision = "L1+L2:agree_safe"
            gemma_reason_text = "Skipped (both safe)"
            gemma_ms = 0
        elif not skip_gemma:
            # Layer 3: Gemma3 Reasoning
            final_type, gemma_reason_text, gemma_ms = gemma3_reason(
                safety, clip_type, clip_conf, clip_top3
            )
            decision = f"L3:gemma({final_type})"
        else:
            # No Gemma -- just use CLIP + moondream logic
            if safety == "safe" and clip_conf >= 0.80:
                # CLIP is very confident about a disaster despite moondream saying safe
                # Trust CLIP (it might be a disaster that moondream missed)
                final_type = clip_type
                decision = "L2:high_conf_override"
            else:
                final_type = clip_type
                decision = "L2:clip"
            gemma_reason_text = "N/A"
            gemma_ms = 0

        img_elapsed = int((time.time() - img_start) * 1000)
        total_time_ms += img_elapsed

        # Score
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

        top3_str = ", ".join([f"{c}:{p:.0%}" for c, p in clip_top3])
        print(
            f"[{i+1:2d}/{total}] {img_id:8s} {icon} "
            f"gate={safety:6s} clip={clip_type:18s}({clip_conf:.0%}) "
            f"final={final_type:18s} exp={expected_type:18s} "
            f"[{decision}] {img_elapsed}ms",
            flush=True,
        )

        results.append({
            "id": img_id,
            "expected_type": expected_type,
            "moondream_gate": safety,
            "moondream_raw": moon_raw[:100],
            "moondream_ms": moon_ms,
            "clip_type": clip_type,
            "clip_confidence": round(clip_conf, 4),
            "clip_top3": [(c, round(p, 4)) for c, p in clip_top3],
            "final_type": final_type,
            "decision": decision,
            "correct": type_correct,
            "gemma_reason": gemma_reason_text[:200],
            "gemma_ms": gemma_ms,
            "total_ms": img_elapsed,
        })

    # Summary
    scored = sum(1 for r in results if r.get("status") != "skip")
    accuracy = correct / scored if scored else 0
    clip_accuracy = clip_only_correct / scored if scored else 0

    print(f"\n{'='*70}")
    print(f"  RESULTS")
    print(f"{'='*70}")
    print(f"  Pipeline Accuracy:  {correct}/{scored} = {accuracy:.1%}")
    print(f"  CLIP-only Accuracy: {clip_only_correct}/{scored} = {clip_accuracy:.1%}")
    delta = accuracy - clip_accuracy
    print(f"  Improvement:        {delta:+.1%} ({correct - clip_only_correct:+d} images)")
    print(f"  Total Time:         {total_time_ms / 1000:.1f}s (avg {total_time_ms / scored:.0f}ms/image)")

    # Moondream gate stats
    print(f"\n  Moondream Safety Gate:")
    st = moondream_stats
    safe_acc = st["safe_correct"] / st["safe_total"] if st["safe_total"] else 0
    unsafe_acc = st["unsafe_correct"] / st["unsafe_total"] if st["unsafe_total"] else 0
    total_gate = st["safe_correct"] + st["unsafe_correct"]
    total_gate_n = st["safe_total"] + st["unsafe_total"]
    gate_acc = total_gate / total_gate_n if total_gate_n else 0
    print(f"    Safe scenes:   {st['safe_correct']}/{st['safe_total']} = {safe_acc:.0%}")
    print(f"    Unsafe scenes: {st['unsafe_correct']}/{st['unsafe_total']} = {unsafe_acc:.0%}")
    print(f"    Overall:       {total_gate}/{total_gate_n} = {gate_acc:.0%}")

    # Per-category breakdown
    print(f"\n  Per-Category Accuracy:")
    for cat in CATEGORIES:
        s = category_stats[cat]
        if s["total"] == 0:
            continue
        cat_acc = s["correct"] / s["total"]
        wrong = f"  wrong: {', '.join(s['preds'])}" if s["preds"] else ""
        print(f"    {cat:20s}: {s['correct']}/{s['total']} = {cat_acc:.0%}{wrong}")

    # Save report
    report = {
        "pipeline": "3-layer-v1",
        "layers": layers,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "accuracy": round(accuracy, 4),
        "clip_only_accuracy": round(clip_accuracy, 4),
        "improvement": round(delta, 4),
        "correct": correct,
        "total": scored,
        "moondream_gate": moondream_stats,
        "total_time_ms": total_time_ms,
        "avg_ms_per_image": round(total_time_ms / scored) if scored else 0,
        "results": results,
    }

    report_path = script_dir / "reports" / "pipeline_benchmark_3layer.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report saved: {report_path}")
    print(f"{'='*70}\n")

    return accuracy

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS 3-Layer Vision Pipeline Benchmark")
    parser.add_argument("--skip-gemma", action="store_true",
                        help="Skip Layer 3 (Gemma3 reasoning), only use Moondream+CLIP")
    parser.add_argument("--single", type=str, help="Classify a single image")
    args = parser.parse_args()

    if args.single:
        img_path = Path(args.single)
        if not img_path.exists():
            print(f"Image not found: {img_path}")
            sys.exit(1)

        print(f"\nClassifying: {img_path}")
        clip = CLIPClassifier()

        # Layer 1
        safety, moon_raw, moon_ms = moondream_safety_gate(img_path)
        print(f"  L1 Moondream: {safety} ({moon_ms}ms) -- {moon_raw}")

        # Layer 2
        clip_results = clip.classify(img_path)
        clip_type = clip_results[0][0]
        clip_conf = clip_results[0][1]
        top3 = ", ".join([f"{c}:{p:.1%}" for c, p in clip_results[:3]])
        print(f"  L2 CLIP:      {clip_type} ({clip_conf:.1%}) -- [{top3}]")

        # Layer 3
        if not args.skip_gemma:
            final, reason, g_ms = gemma3_reason(safety, clip_type, clip_conf, clip_results[:3])
            print(f"  L3 Gemma3:    {final} ({g_ms}ms) -- {reason}")
        else:
            print("  L3 Gemma3:    skipped")

        sys.exit(0)

    run_pipeline(skip_gemma=args.skip_gemma)

