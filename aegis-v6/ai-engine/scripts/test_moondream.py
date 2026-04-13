"""
Module: test_moondream.py

Test_moondream AI engine module.
"""

import base64, requests, json

img = open('../server/uploads/chat/benchmark/wf-001.jpg', 'rb').read()
b64 = base64.b64encode(img).decode()
print(f'Image size: {len(img)} bytes, b64 length: {len(b64)}')

resp = requests.post('http://localhost:11434/api/generate', json={
    'model': 'moondream:latest',
    'prompt': 'What do you see in this image?',
    'images': [b64],
    'stream': False,
    'options': {'temperature': 0.1, 'num_predict': 50}
}, timeout=60)

print(f'Status: {resp.status_code}')
data = resp.json()
print(f'Response keys: {list(data.keys())}')
print(f'Response text: {repr(data.get("response", "MISSING"))}')
print(f'Done: {data.get("done", "MISSING")}')
print(f'Total duration: {data.get("total_duration", 0) / 1e9:.2f}s')
