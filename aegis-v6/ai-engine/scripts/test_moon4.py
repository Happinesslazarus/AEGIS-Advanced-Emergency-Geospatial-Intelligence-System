import base64, requests
from pathlib import Path

upload_base = Path('../server/uploads/chat/benchmark')
test_ids = ['wf-001', 'sf-001', 'sf-003']

prompts = {
    "A": "Is this a disaster scene? Yes or no.",
    "B": "Describe what you see in this image in one sentence.",
    "C": "Does this image show any danger, destruction, or emergency?",
    "D": "Is this scene safe and normal, or does it show damage or disaster?",
    "E": "What do you see in this image?",
}

for pname, prompt in prompts.items():
    print(f"\n--- Prompt {pname}: {prompt}")
    for img_id in test_ids:
        img_file = upload_base / f'{img_id}.jpg'
        if not img_file.exists():
            img_file = upload_base / f'{img_id}.png'

        with open(img_file, 'rb') as f:
            img_b64 = base64.b64encode(f.read()).decode()

        resp = requests.post('http://localhost:11434/api/generate', json={
            'model': 'moondream:latest',
            'prompt': prompt,
            'images': [img_b64],
            'stream': False,
            'options': {'temperature': 0.1, 'num_predict': 60}
        }, timeout=60)

        data = resp.json()
        raw = data.get('response', '').strip()
        ec = data.get('eval_count', '?')
        td = data.get('total_duration', 0) / 1e9
        print(f"  {img_id}: ec={ec} {td:.2f}s | {repr(raw[:120])}")
