"""
Module: check_env.py

Check_env AI engine module.
"""
import sys
import os

results = []

# Check torch
try:
    import torch
    results.append(f"torch: {torch.__version__}")
    results.append(f"cuda: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        results.append(f"gpu: {torch.cuda.get_device_name(0)}")
        results.append(f"vram: {torch.cuda.get_device_properties(0).total_mem // 1024**2}MB")
except ImportError:
    results.append("torch: NOT INSTALLED")

# Check torchvision
try:
    import torchvision
    results.append(f"torchvision: {torchvision.__version__}")
except ImportError:
    results.append("torchvision: NOT INSTALLED")

# Check open_clip
try:
    import open_clip
    results.append(f"open_clip: {open_clip.__version__}")
except ImportError:
    results.append("open_clip: NOT INSTALLED")

# Check transformers
try:
    import transformers
    results.append(f"transformers: {transformers.__version__}")
except ImportError:
    results.append("transformers: NOT INSTALLED")

# Check PIL
try:
    from PIL import Image
    results.append(f"pillow: OK")
except ImportError:
    results.append("pillow: NOT INSTALLED")

# Write results
out_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'env_check.txt')
with open(out_path, 'w') as f:
    f.write('\n'.join(results) + '\n')
print('\n'.join(results))
