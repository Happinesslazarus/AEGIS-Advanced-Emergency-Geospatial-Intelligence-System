"""
Test_moon3 AI engine module.
"""

import base64, requests
from pathlib import Path

upload_base = Path('../server/uploads/chat/benchmark')
test_ids = ['wf-001', 'sf-001', 'sf-003']

for img_id in test_ids:
    img_file = upload_base / f'{img_id}.jpg'
    if not img_file.exists():
        img_file = upload_base / f'{img_id}.png'

    with open(img_file, 'rb') as f:
        img_b64 = base64.b64encode(f.read()).decode()

    prompt = (
        "Look at this image carefully. Is this scene showing a disaster, "
        "emergency, or dangerous situation? Or is this a normal safe scene?\n\n"
        "Answer with exactly one word: SAFE or UNSAFE"
    )

    resp = requests.post('http://localhost:11434/api/generate', json={
        'model': 'moondream:latest',
        'prompt': prompt,
        'images': [img_b64],
        'stream': False,
        'options': {'temperature': 0.1, 'num_predict': 20}
    }, timeout=60)

    data = resp.json()
    raw = data.get('response', '').strip()
    ec = data.get('eval_count', '?')
    td = data.get('total_duration', 0) / 1e9
    print(f"{img_id}: eval_count={ec} time={td:.2f}s raw={repr(raw)}")
