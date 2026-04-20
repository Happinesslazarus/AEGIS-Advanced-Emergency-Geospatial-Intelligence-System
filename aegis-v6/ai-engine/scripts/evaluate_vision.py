#!/usr/bin/env python3
"""
Evaluate_vision AI engine module.
"""

import argparse
import json
import sys
import time
import os
import uuid
from pathlib import Path
from datetime import datetime
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import URLError

BENCHMARK_FILE = Path(__file__).parent.parent / "data" / "vision_benchmark.json"
REPORTS_DIR = Path(__file__).parent.parent / "reports"

# Severity ranking for distance-based scoring
SEVERITY_RANK = {"none": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}

# Type equivalences (some responses may use related terms)
TYPE_ALIASES = {
    "wildfire": {"wildfire", "fire", "bushfire", "forest_fire"},
    "flood": {"flood", "flooding", "flash_flood", "inundation"},
    "earthquake": {"earthquake", "seismic", "quake", "structural_damage", "infrastructure_damage", "collapse"},
    "storm": {"storm", "severe_storm", "hurricane", "cyclone", "tornado", "typhoon", "wind_damage", "thunderstorm"},
    "landslide": {"landslide", "mudslide", "debris_flow", "slope_failure"},
    "drought": {"drought", "arid", "water_shortage", "heatwave", "heat_wave", "extreme_heat"},
    "structural_damage": {"structural_damage", "infrastructure_damage", "collapse", "bridge_collapse", "infrastructure_failure", "sinkhole", "earthquake", "seismic", "quake"},
    "heatwave": {"heatwave", "heat_wave", "extreme_heat", "drought", "arid", "water_shortage"},
    "safe": {"safe", "none", "no_hazard", "normal", "unknown"},
}

def type_matches(predicted: str, expected: str) -> bool:
    """Check if predicted type matches expected, allowing aliases."""
    predicted = predicted.lower().strip().replace(" ", "_")
    expected = expected.lower().strip().replace(" ", "_")
    if predicted == expected:
        return True
    expected_aliases = TYPE_ALIASES.get(expected, {expected})
    return predicted in expected_aliases

def severity_distance(predicted: str, expected: str) -> int:
    """Distance between severity levels (0 = exact match, 4 = max error)."""
    p = SEVERITY_RANK.get(predicted.lower().strip(), 2)
    e = SEVERITY_RANK.get(expected.lower().strip(), 2)
    return abs(p - e)

def call_vision_api(api_url: str, image_url: str, timeout: int = 90) -> dict:
    """Call the AEGIS chat API with an image to trigger vision analysis."""
    endpoint = f"{api_url}/api/chat"
    payload = json.dumps({
        "message": f"[The citizen attached an image: {image_url}] Analyze this image for disaster assessment.",
        "sessionId": str(uuid.uuid4()),
    }).encode("utf-8")

    req = Request(endpoint, data=payload, headers={"Content-Type": "application/json"})
    start = time.time()
    try:
        resp = urlopen(req, timeout=timeout)
        elapsed_ms = int((time.time() - start) * 1000)
        body = json.loads(resp.read().decode("utf-8"))
        reply: str = body.get("response", body.get("reply", body.get("message", "")))
        return {"success": True, "response": reply, "elapsed_ms": elapsed_ms}
    except (URLError, TimeoutError, Exception) as e:
        elapsed_ms = int((time.time() - start) * 1000)
        return {"success": False, "error": str(e), "elapsed_ms": elapsed_ms, "response": ""}

def extract_structured_from_response(response: str) -> dict:
    """Extract structured fields from the vision response text."""
    result = {
        "disaster_type": "unknown",
        "severity": "moderate",
        "confidence": 50,
    }

    # Try JSON block
    import re
    json_match = re.search(r"```json\s*(.*?)```", response, re.DOTALL)
    if not json_match:
        json_match = re.search(r'\{"disaster_type".*?\}', response, re.DOTALL)
    if json_match:
        try:
            text = json_match.group(1) if json_match.lastindex else json_match.group(0)
            parsed = json.loads(text)
            result["disaster_type"] = parsed.get("disaster_type", result["disaster_type"])
            result["severity"] = parsed.get("severity", result["severity"])
            result["confidence"] = int(parsed.get("confidence", result["confidence"]))
            return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Fallback: heuristic extraction from response text
    lower = response.lower()

    # Check for "Temporarily Unavailable" -- vision didn't run
    if "temporarily unavailable" in lower or "having trouble connecting" in lower:
        result["disaster_type"] = "__unavailable__"
        result["severity"] = "unknown"
        result["confidence"] = 0
        return result

    # Extract from various header formats:
    # "**Detected:** WILDFIRE" or "**Disaster Type:** Wildfire" or "**Type:** flood"
    # Also: "active **WILDFIRE** scene" or "depicts a **FLOOD**"
    det_match = re.search(r"\*\*(?:detected|disaster[_ ]type|type|classification):\*\*\s*(\w+)", lower)
    if not det_match:
        # Try bold-wrapped type: "active **WILDFIRE**" or "depicts a **FLOOD**"
        type_words = "wildfire|flood|earthquake|storm|hurricane|tornado|landslide|drought|heatwave|structural[_ ]damage|infrastructure|safe|volcanic|environmental"
        det_match = re.search(r"\*\*(" + type_words + r")\*\*", lower)
    sev_match = re.search(r"\*\*severity:\*\*\s*(\w+)", lower)
    if not sev_match:
        sev_match = re.search(r"severity[:\s]+\*?\*?(\b(?:none|low|moderate|high|critical)\b)", lower)
    conf_match = re.search(r"(\d{1,3})%\s*confidence", lower)
    if not conf_match:
        conf_match = re.search(r"confidence[:\s]+(\d{1,3})%", lower)

    if det_match:
        result["disaster_type"] = det_match.group(1)
    if sev_match:
        result["severity"] = sev_match.group(1)
    if conf_match:
        result["confidence"] = min(100, int(conf_match.group(1)))

    return result

def run_benchmark(
    api_url: str,
    benchmark: list[dict],
    category: str | None = None,
    limit: int | None = None,
) -> dict:
    """Run the benchmark suite and return results."""
    items = benchmark
    if category:
        items = [b for b in items if b["expected_type"] == category]
    if limit:
        items = items[:limit]

    print(f"\n{'='*60}")
    print(f"  AEGIS Vision Benchmark -- {len(items)} images")
    print(f"  API: {api_url}")
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    results: list[dict[str, Any]] = []
    type_correct = 0
    severity_exact = 0
    severity_close = 0  # within 1 level
    total_time_ms = 0
    false_positives = 0  # predicted disaster when safe
    false_negatives = 0  # predicted safe when disaster
    confidence_sum = 0

    for i, item in enumerate(items, 1):
        # Prefer local_path (cached images) over remote URL
        image_url = item.get("local_path", item["url"])
        print(f"[{i}/{len(items)}] {item['id']}: {item['description'][:50]}...", end=" ", flush=True)

        # Retry up to 2 times if vision is unavailable (rate-limited)
        api_result = None
        extracted = None
        for attempt in range(3):
            api_result = call_vision_api(api_url, image_url)
            if not api_result["success"]:
                break
            extracted = extract_structured_from_response(api_result["response"])
            if extracted["disaster_type"] != "__unavailable__":
                break
            if attempt < 2:
                print(f"⏳ rate-limited, waiting 30s...", end=" ", flush=True)
                time.sleep(30)
        
        if extracted and extracted["disaster_type"] == "__unavailable__":
            print(f"[WARN] VISION UNAVAILABLE (rate-limited)")
            results.append({**item, "status": "rate_limited", "elapsed_ms": api_result["elapsed_ms"]})
            time.sleep(15)
            continue

        if not api_result["success"]:
            print(f"[ERR] ERROR ({api_result.get('error', 'unknown')[:40]})")
            results.append({**item, "status": "error", "error": api_result.get("error"), "elapsed_ms": api_result["elapsed_ms"]})
            continue

        extracted = extract_structured_from_response(api_result["response"])
        type_ok = type_matches(extracted["disaster_type"], item["expected_type"])
        sev_dist = severity_distance(extracted["severity"], item["expected_severity"])

        total_time_ms += api_result["elapsed_ms"]
        confidence_sum += extracted["confidence"]

        if type_ok:
            type_correct += 1
        if sev_dist == 0:
            severity_exact += 1
        if sev_dist <= 1:
            severity_close += 1

        is_safe_expected = item["expected_type"] == "safe"
        is_safe_predicted = extracted["disaster_type"] in ("safe", "none", "unknown")
        if not is_safe_expected and is_safe_predicted:
            false_negatives += 1
        if is_safe_expected and not is_safe_predicted:
            false_positives += 1

        icon = "[OK]" if type_ok else "[FAIL]"
        print(f"{icon} pred={extracted['disaster_type']}/{extracted['severity']} "
              f"exp={item['expected_type']}/{item['expected_severity']} "
              f"conf={extracted['confidence']}% {api_result['elapsed_ms']}ms")

        results.append({
            **item,
            "status": "ok",
            "predicted_type": extracted["disaster_type"],
            "predicted_severity": extracted["severity"],
            "predicted_confidence": extracted["confidence"],
            "type_correct": type_ok,
            "severity_distance": sev_dist,
            "elapsed_ms": api_result["elapsed_ms"],
            "raw_response": api_result["response"][:500],
        })

        # Rate-limit to avoid hammering free APIs (8s between requests)
        time.sleep(8)

    n = len([r for r in results if r["status"] == "ok"])
    errors = len([r for r in results if r["status"] == "error"])
    rate_limited = len([r for r in results if r["status"] == "rate_limited"])

    summary = {
        "total": len(items),
        "evaluated": n,
        "errors": errors,
        "type_accuracy": round(type_correct / n * 100, 1) if n else 0,
        "severity_exact_accuracy": round(severity_exact / n * 100, 1) if n else 0,
        "severity_close_accuracy": round(severity_close / n * 100, 1) if n else 0,
        "avg_confidence": round(confidence_sum / n, 1) if n else 0,
        "avg_time_ms": round(total_time_ms / n) if n else 0,
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "timestamp": datetime.now().isoformat(),
        "results": results,
    }

    # Per-category breakdown
    categories: dict[str, dict] = {}
    for r in results:
        if r["status"] != "ok":
            continue
        cat = r["expected_type"]
        if cat not in categories:
            categories[cat] = {"total": 0, "correct": 0}
        categories[cat]["total"] += 1
        if r.get("type_correct"):
            categories[cat]["correct"] += 1
    for cat, data in categories.items():
        data["accuracy"] = round(data["correct"] / data["total"] * 100, 1) if data["total"] else 0
    summary["per_category"] = categories

    print(f"\n{'='*60}")
    print(f"  RESULTS SUMMARY")
    print(f"{'='*60}")
    print(f"  Type Accuracy:        {summary['type_accuracy']}%  ({type_correct}/{n})")
    print(f"  Severity Exact:       {summary['severity_exact_accuracy']}%")
    print(f"  Severity Within ±1:   {summary['severity_close_accuracy']}%")
    print(f"  Avg Confidence:       {summary['avg_confidence']}%")
    print(f"  Avg Response Time:    {summary['avg_time_ms']}ms")
    print(f"  False Positives:      {false_positives}")
    print(f"  False Negatives:      {false_negatives}")
    print(f"  Rate Limited:         {rate_limited}")
    print(f"  API Errors:           {errors}")
    print()
    print("  Per-category breakdown:")
    for cat, data in sorted(categories.items()):
        bar = "#" * int(data["accuracy"] / 5) + " " * (20 - int(data["accuracy"] / 5))
        print(f"    {cat:20s} {bar} {data['accuracy']:5.1f}%  ({data['correct']}/{data['total']})")
    print(f"{'='*60}\n")

    return summary

def generate_html_report(summary: dict) -> str:
    """Generate an HTML benchmark report."""
    cats = summary.get("per_category", {})
    cat_rows = "".join(
        f"<tr><td>{cat}</td><td>{d['correct']}/{d['total']}</td><td>{d['accuracy']}%</td>"
        f"<td><div style='background:#e0e0e0;border-radius:4px;overflow:hidden'>"
        f"<div style='width:{d['accuracy']}%;height:16px;background:{'#4caf50' if d['accuracy']>=80 else '#ff9800' if d['accuracy']>=50 else '#f44336'}'></div></div></td></tr>"
        for cat, d in sorted(cats.items())
    )

    detail_rows = ""
    for r in summary.get("results", []):
        if r["status"] != "ok":
            continue
        icon = "[OK]" if r.get("type_correct") else "[FAIL]"
        detail_rows += (
            f"<tr><td>{r['id']}</td><td>{r['description'][:40]}</td>"
            f"<td>{r['expected_type']}</td><td>{r.get('predicted_type','?')}</td>"
            f"<td>{icon}</td><td>{r['expected_severity']}</td><td>{r.get('predicted_severity','?')}</td>"
            f"<td>{r.get('predicted_confidence',0)}%</td><td>{r.get('elapsed_ms',0)}ms</td></tr>"
        )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AEGIS Vision Benchmark Report</title>
<style>
body{{font-family:system-ui;margin:2rem;background:#1a1a2e;color:#e0e0e0}}
h1{{color:#00d2ff}}h2{{color:#7b68ee;margin-top:2rem}}
table{{border-collapse:collapse;width:100%;margin:1rem 0}}
th,td{{padding:8px 12px;border:1px solid #333;text-align:left}}
th{{background:#2a2a4e;color:#00d2ff}}
tr:nth-child(even){{background:#1e1e3a}}
.metric{{display:inline-block;background:#2a2a4e;padding:1rem 2rem;border-radius:8px;margin:0.5rem;text-align:center}}
.metric .value{{font-size:2rem;font-weight:bold;color:#00d2ff}}
.metric .label{{font-size:0.85rem;color:#888}}
</style></head><body>
<h1>AEGIS Vision Benchmark Report</h1>
<p>Generated: {summary['timestamp']}</p>
<div>
<div class="metric"><div class="value">{summary['type_accuracy']}%</div><div class="label">Type Accuracy</div></div>
<div class="metric"><div class="value">{summary['severity_exact_accuracy']}%</div><div class="label">Severity Exact</div></div>
<div class="metric"><div class="value">{summary['severity_close_accuracy']}%</div><div class="label">Severity ±1</div></div>
<div class="metric"><div class="value">{summary['avg_confidence']}%</div><div class="label">Avg Confidence</div></div>
<div class="metric"><div class="value">{summary['avg_time_ms']}ms</div><div class="label">Avg Speed</div></div>
<div class="metric"><div class="value">{summary['false_positives']}</div><div class="label">False Positives</div></div>
<div class="metric"><div class="value">{summary['false_negatives']}</div><div class="label">False Negatives</div></div>
</div>
<h2>Per-Category Accuracy</h2>
<table><tr><th>Category</th><th>Correct/Total</th><th>Accuracy</th><th>Bar</th></tr>{cat_rows}</table>
<h2>Detailed Results</h2>
<table><tr><th>ID</th><th>Description</th><th>Expected Type</th><th>Predicted Type</th><th>Match</th>
<th>Expected Sev</th><th>Predicted Sev</th><th>Confidence</th><th>Time</th></tr>{detail_rows}</table>
</body></html>"""

def main():
    parser = argparse.ArgumentParser(description="AEGIS Vision Benchmark Runner")
    parser.add_argument("--api-url", default="http://localhost:3001", help="AEGIS server URL")
    parser.add_argument("--category", type=str, help="Filter by disaster category")
    parser.add_argument("--limit", type=int, help="Limit number of images to test")
    parser.add_argument("--report", action="store_true", help="Generate HTML report")
    parser.add_argument("--output", type=str, help="Output file for report/results")
    args = parser.parse_args()

    if not BENCHMARK_FILE.exists():
        print(f"ERROR: Benchmark file not found: {BENCHMARK_FILE}")
        sys.exit(1)

    with open(BENCHMARK_FILE) as f:
        data = json.load(f)

    benchmark = data.get("benchmark", [])
    print(f"Loaded {len(benchmark)} benchmark images from {BENCHMARK_FILE.name}")

    summary = run_benchmark(args.api_url, benchmark, args.category, args.limit)

    # Save JSON results
    REPORTS_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = args.output or str(REPORTS_DIR / f"vision_benchmark_{ts}.json")
    with open(json_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Results saved to: {json_path}")

    if args.report:
        html = generate_html_report(summary)
        html_path = json_path.replace(".json", ".html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"HTML report saved to: {html_path}")

if __name__ == "__main__":
    main()
