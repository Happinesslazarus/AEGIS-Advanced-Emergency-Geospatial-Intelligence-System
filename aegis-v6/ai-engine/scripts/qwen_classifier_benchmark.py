"""
Qwen_classifier_benchmark AI engine module.
"""
import json, base64, requests, time, sys
from pathlib import Path
from collections import defaultdict

CATEGORIES = ['wildfire', 'flood', 'earthquake', 'storm', 'landslide',
              'drought', 'structural_damage', 'heatwave', 'safe']

TYPE_ALIASES = {
    'earthquake': {'earthquake', 'structural_damage'},
    'structural_damage': {'structural_damage', 'earthquake'},
    'drought': {'drought', 'heatwave'},
    'heatwave': {'heatwave', 'drought'},
}

# Keyword mapping: what words in the response map to which category
KEYWORD_MAP = {
    'wildfire': ['wildfire', 'fire', 'burning', 'flames', 'blaze', 'inferno'],
    'flood': ['flood', 'flooding', 'submerged', 'inundation', 'floodwater'],
    'earthquake': ['earthquake', 'seismic', 'quake', 'tremor'],
    'storm': ['storm', 'hurricane', 'tornado', 'cyclone', 'typhoon', 'lightning', 'thunderstorm'],
    'landslide': ['landslide', 'mudslide', 'mudflow', 'debris flow', 'rockslide', 'slope failure'],
    'drought': ['drought', 'arid', 'dry', 'parched', 'desiccated', 'cracked earth'],
    'structural_damage': ['structural', 'collapse', 'collapsed', 'rubble', 'demolished', 'destroyed building', 'damaged building'],
    'heatwave': ['heatwave', 'heat wave', 'extreme heat', 'heat shimmer', 'scorching'],
    'safe': ['safe', 'normal', 'peaceful', 'no disaster', 'no damage', 'intact', 'everyday'],
}

CLASSIFICATION_PROMPT = """Classify this image into exactly ONE of these disaster categories:
wildfire, flood, earthquake, storm, landslide, drought, structural_damage, heatwave, safe

Rules:
- "safe" means no disaster is visible
- Reply with ONLY the category name, nothing else

Category:"""

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen2.5vl:7b"

def parse_category(response_text: str) -> str:
    """Extract category from model response."""
    text = response_text.strip().lower()
    
    # Direct match first
    for cat in CATEGORIES:
        if cat in text:
            return cat
    
    # Try keyword matching
    scores = defaultdict(int)
    for cat, keywords in KEYWORD_MAP.items():
        for kw in keywords:
            if kw in text:
                scores[cat] += 1
    
    if scores:
        return max(scores, key=scores.get)
    
    return "unknown"

def is_match(predicted: str, expected: str) -> bool:
    if predicted == expected:
        return True
    return predicted in TYPE_ALIASES.get(expected, set())

def main():
    script_dir = Path(__file__).resolve().parent.parent
    bp = script_dir / 'data' / 'vision_benchmark.json'
    ub = script_dir.parent / 'server' / 'uploads' / 'chat' / 'benchmark'
    
    images = json.load(open(bp))['benchmark']
    print(f"Qwen2.5-VL 7B Direct Classifier Benchmark", flush=True)
    print(f"Images: {len(images)}", flush=True)
    print(f"Model: {MODEL}", flush=True)
    print("=" * 70, flush=True)
    
    results = []
    correct = 0
    total = 0
    category_stats = defaultdict(lambda: {'correct': 0, 'total': 0, 'predictions': []})
    
    t_start = time.time()
    
    for i, img_data in enumerate(images):
        img_id = img_data['id']
        expected = img_data['expected_type']
        img_file = ub / f'{img_id}.jpg'
        if not img_file.exists():
            img_file = ub / f'{img_id}.png'
        if not img_file.exists():
            print(f"[{i+1:2d}/42] {img_id}: FILE NOT FOUND", flush=True)
            continue
        
        b64 = base64.b64encode(open(img_file, 'rb').read()).decode()
        
        t0 = time.time()
        try:
            resp = requests.post(OLLAMA_URL, json={
                'model': MODEL,
                'prompt': CLASSIFICATION_PROMPT,
                'images': [b64],
                'stream': False,
                'options': {'temperature': 0.1, 'num_predict': 20}
            }, timeout=300)
            elapsed = time.time() - t0
            
            result = resp.json()
            raw_response = result.get('response', '').strip()
            predicted = parse_category(raw_response)
            matched = is_match(predicted, expected)
            
            if matched:
                correct += 1
            total += 1
            
            category_stats[expected]['total'] += 1
            category_stats[expected]['predictions'].append(predicted)
            if matched:
                category_stats[expected]['correct'] += 1
            
            status = "OK" if matched else "MISS"
            print(f"[{i+1:2d}/42] {img_id} ({expected}): {raw_response[:60]:60s} -> {predicted:20s} [{status}] {elapsed:.0f}s", flush=True)
            
            results.append({
                'id': img_id,
                'expected': expected,
                'predicted': predicted,
                'raw_response': raw_response,
                'matched': matched,
                'time_seconds': round(elapsed, 1)
            })
            
        except requests.exceptions.Timeout:
            print(f"[{i+1:2d}/42] {img_id} ({expected}): TIMEOUT (300s)", flush=True)
            total += 1
            category_stats[expected]['total'] += 1
            results.append({
                'id': img_id,
                'expected': expected,
                'predicted': 'timeout',
                'raw_response': 'TIMEOUT',
                'matched': False,
                'time_seconds': 300
            })
        except Exception as e:
            print(f"[{i+1:2d}/42] {img_id} ({expected}): ERROR: {e}", flush=True)
            total += 1
            category_stats[expected]['total'] += 1
            results.append({
                'id': img_id,
                'expected': expected,
                'predicted': 'error',
                'raw_response': str(e),
                'matched': False,
                'time_seconds': 0
            })
    
    total_time = time.time() - t_start
    accuracy = (correct / total * 100) if total > 0 else 0
    
    print("\n" + "=" * 70, flush=True)
    print(f"RESULTS: {correct}/{total} = {accuracy:.1f}%", flush=True)
    print(f"Total time: {total_time:.0f}s ({total_time/60:.1f} min)", flush=True)
    print(f"Avg per image: {total_time/total:.1f}s", flush=True)
    
    print("\nPer-category breakdown:", flush=True)
    for cat in CATEGORIES:
        stats = category_stats.get(cat)
        if stats and stats['total'] > 0:
            cat_acc = stats['correct'] / stats['total'] * 100
            preds = ', '.join(stats['predictions'])
            print(f"  {cat:20s}: {stats['correct']}/{stats['total']} ({cat_acc:.0f}%)  predictions: [{preds}]", flush=True)
    
    # Save report
    report = {
        'model': MODEL,
        'mode': 'direct_classifier',
        'prompt': CLASSIFICATION_PROMPT,
        'accuracy': round(accuracy, 1),
        'correct': correct,
        'total': total,
        'total_time_seconds': round(total_time, 1),
        'avg_time_per_image': round(total_time / total, 1) if total > 0 else 0,
        'results': results,
        'category_stats': {cat: {'correct': s['correct'], 'total': s['total']} 
                          for cat, s in category_stats.items()}
    }
    
    report_path = script_dir / 'reports' / 'qwen25vl_classifier_benchmark.json'
    report_path.parent.mkdir(exist_ok=True)
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved: {report_path}", flush=True)

if __name__ == '__main__':
    main()
