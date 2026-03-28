"""
AEGIS Vision - EfficientNet Fine-Tuning for Disaster Image Classification
Fine-tunes EfficientNet-B0 (pre-trained on ImageNet) on AEGIS disaster images
with heavy data augmentation to overcome the small dataset (42 images).

Evaluation: Leave-One-Out (LOO) cross-validation for unbiased accuracy.

Usage:
    python scripts/train_efficientnet.py                    # Full LOO benchmark
    python scripts/train_efficientnet.py --epochs 20        # More training
    python scripts/train_efficientnet.py --train-final      # Train production model
"""

import json
import sys
import time
import argparse
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
from PIL import Image
import timm
import numpy as np

# Categories

CATEGORIES = [
    "wildfire", "flood", "earthquake", "storm", "landslide",
    "drought", "structural_damage", "heatwave", "safe"
]
CAT_TO_IDX = {c: i for i, c in enumerate(CATEGORIES)}

# Acceptable cross-predictions (visually similar categories)
TYPE_ALIASES = {
    "earthquake": {"earthquake", "structural_damage"},
    "structural_damage": {"structural_damage", "earthquake"},
    "drought": {"drought", "heatwave"},
    "heatwave": {"heatwave", "drought"},
}

# Dataset

class DisasterDataset(Dataset):
    """Disaster image dataset with on-the-fly augmentation."""

    def __init__(self, image_paths, labels, transform, n_augment=1):
        self.image_paths = image_paths
        self.labels = labels
        self.transform = transform
        self.n_augment = n_augment

    def __len__(self):
        return len(self.image_paths) * self.n_augment

    def __getitem__(self, idx):
        img_idx = idx // self.n_augment
        img = Image.open(self.image_paths[img_idx]).convert("RGB")
        img = self.transform(img)
        return img, self.labels[img_idx]

# Transforms

train_transform = T.Compose([
    T.RandomResizedCrop(224, scale=(0.5, 1.0)),
    T.RandomHorizontalFlip(),
    T.RandomVerticalFlip(p=0.15),
    T.RandomRotation(25),
    T.ColorJitter(brightness=0.4, contrast=0.4, saturation=0.4, hue=0.1),
    T.RandomGrayscale(p=0.05),
    T.GaussianBlur(kernel_size=3, sigma=(0.1, 2.0)),
    T.RandomPerspective(distortion_scale=0.2, p=0.3),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    T.RandomErasing(p=0.15),
])

test_transform = T.Compose([
    T.Resize(256),
    T.CenterCrop(224),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# Model

def create_model(num_classes=9, device="cuda"):
    """Create EfficientNet-B0 with frozen backbone, trainable last block + head."""
    model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=num_classes)

    # Freeze all except last conv block + classifier
    for name, param in model.named_parameters():
        if "classifier" in name or "blocks.6" in name or "conv_head" in name or "bn2" in name:
            param.requires_grad = True
        else:
            param.requires_grad = False

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"  Parameters: {trainable:,} trainable / {total:,} total ({trainable/total*100:.1f}%)", flush=True)

    return model.to(device)

# Training

def train_one_fold(model, train_loader, device, epochs=15, lr=1e-3):
    """Train model for one LOO fold."""
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    optimizer = optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=lr, weight_decay=1e-2
    )
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        total_loss = 0
        correct = 0
        total = 0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            _, predicted = outputs.max(1)
            correct += predicted.eq(labels).sum().item()
            total += labels.size(0)
        scheduler.step()

    return total_loss / len(train_loader), correct / total

def evaluate_single(model, image_path, device):
    """Evaluate model on a single test image. Returns (pred_idx, probabilities)."""
    model.eval()
    img = Image.open(image_path).convert("RGB")
    inp = test_transform(img).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(inp)
        probs = torch.softmax(logits, dim=1).squeeze(0).cpu().numpy()
    return int(probs.argmax()), probs

# Benchmark

def load_benchmark(script_dir):
    """Load benchmark images and return (paths, labels, ids, metadata)."""
    bp = script_dir / "data" / "vision_benchmark.json"
    ub = script_dir.parent / "server" / "uploads" / "chat" / "benchmark"

    benchmark = json.load(open(bp, encoding="utf-8"))
    images = benchmark.get("benchmark", [])

    paths, labels, ids, meta = [], [], [], []
    for img_data in images:
        img_id = img_data["id"]
        img_file = ub / f"{img_id}.jpg"
        if not img_file.exists():
            img_file = ub / f"{img_id}.png"
        if not img_file.exists():
            print(f"  WARNING: Image not found: {img_id}", flush=True)
            continue

        cat = img_data["expected_type"]
        if cat not in CAT_TO_IDX:
            print(f"  WARNING: Unknown category '{cat}' for {img_id}", flush=True)
            continue

        paths.append(img_file)
        labels.append(CAT_TO_IDX[cat])
        ids.append(img_id)
        meta.append(img_data)

    return paths, labels, ids, meta

def is_match(pred_cat, expected_cat):
    """Check if prediction matches expected (with alias tolerance)."""
    if pred_cat == expected_cat:
        return True
    return pred_cat in TYPE_ALIASES.get(expected_cat, set())

def run_loo_benchmark(script_dir, args):
    """Run Leave-One-Out cross-validation benchmark."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n{'='*60}", flush=True)
    print(f"  AEGIS EfficientNet-B0 LOO Benchmark", flush=True)
    print(f"  Device: {device} | Epochs: {args.epochs} | Aug: {args.n_augment}x", flush=True)
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
    print(f"{'='*60}\n", flush=True)

    paths, labels, ids, meta = load_benchmark(script_dir)
    n = len(paths)
    print(f"Loaded {n} images across {len(set(labels))} categories", flush=True)

    # Class distribution
    dist = Counter(labels)
    for cat_idx in sorted(dist.keys()):
        cat = CATEGORIES[cat_idx]
        print(f"  {cat:>20s}: {dist[cat_idx]}", flush=True)

    # LOO evaluation
    results = []
    correct_strict = 0
    correct_alias = 0
    per_cat_correct = defaultdict(int)
    per_cat_total = defaultdict(int)
    per_cat_misses = defaultdict(list)

    t_start = time.time()

    for i in range(n):
        t_fold = time.time()

        # Split: leave image i out
        train_paths = [p for j, p in enumerate(paths) if j != i]
        train_labels = [l for j, l in enumerate(labels) if j != i]
        test_path = paths[i]
        test_label = labels[i]
        test_id = ids[i]
        test_meta = meta[i]
        expected_cat = CATEGORIES[test_label]

        # Create augmented training dataset
        train_ds = DisasterDataset(
            train_paths,
            train_labels,
            transform=train_transform,
            n_augment=args.n_augment,
        )
        train_loader = DataLoader(
            train_ds,
            batch_size=args.batch_size,
            shuffle=True,
            num_workers=0,
            pin_memory=True,
            drop_last=True,
        )

        # Fresh model for each fold
        model = create_model(num_classes=len(CATEGORIES), device=device)

        # Train
        loss, train_acc = train_one_fold(
            model, train_loader, device,
            epochs=args.epochs, lr=args.lr
        )

        # Evaluate on held-out image
        pred_idx, probs = evaluate_single(model, test_path, device)
        pred_cat = CATEGORIES[pred_idx]
        conf = float(probs[pred_idx])

        # Top-3 predictions
        top3_idx = probs.argsort()[::-1][:3]
        top3 = [(CATEGORIES[j], float(probs[j])) for j in top3_idx]
        top3_str = ", ".join([f"{c}:{p*100:.0f}%" for c, p in top3])

        # Check match
        strict_match = pred_cat == expected_cat
        alias_match = is_match(pred_cat, expected_cat)

        if strict_match:
            correct_strict += 1
        if alias_match:
            correct_alias += 1
            per_cat_correct[expected_cat] += 1
            marker = "OK"
        else:
            per_cat_misses[expected_cat].append(pred_cat)
            marker = "XX"
        per_cat_total[expected_cat] += 1

        elapsed = time.time() - t_fold

        desc = test_meta.get("description", "")[:45]
        print(
            f"[{i+1:2d}/{n}] {test_id}: {desc:<45s} "
            f"{'PASS' if alias_match else 'FAIL'} "
            f"pred={pred_cat}/{conf*100:.0f}% exp={expected_cat} "
            f"{elapsed:.0f}s  [{top3_str}]",
            flush=True,
        )

        results.append({
            "id": test_id,
            "expected": expected_cat,
            "predicted": pred_cat,
            "confidence": round(conf, 4),
            "match_strict": strict_match,
            "match_alias": alias_match,
            "top3": [{"category": c, "probability": round(p, 4)} for c, p in top3],
            "fold_time_s": round(elapsed, 1),
        })

        # Free GPU memory
        del model
        torch.cuda.empty_cache()

    total_time = time.time() - t_start
    acc_strict = correct_strict / n * 100
    acc_alias = correct_alias / n * 100

    # Print summary
    print(f"\n{'='*60}", flush=True)
    print(f"  RESULTS SUMMARY", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"  Model:               EfficientNet-B0 (fine-tuned)", flush=True)
    print(f"  Accuracy (alias):    {acc_alias:.1f}%  ({correct_alias}/{n})", flush=True)
    print(f"  Accuracy (strict):   {acc_strict:.1f}%  ({correct_strict}/{n})", flush=True)
    print(f"  Total Time:          {total_time:.0f}s ({total_time/n:.1f}s/fold)", flush=True)
    print(f"  Augmentation:        {args.n_augment}x per image", flush=True)
    print(f"  Epochs/fold:         {args.epochs}", flush=True)
    print(f"", flush=True)

    print(f"  Per-category breakdown:", flush=True)
    for cat in CATEGORIES:
        total = per_cat_total.get(cat, 0)
        if total == 0:
            continue
        correct = per_cat_correct.get(cat, 0)
        cat_acc = correct / total * 100
        bar = "#" * int(cat_acc / 5) + "." * (20 - int(cat_acc / 5))
        misses = per_cat_misses.get(cat, [])
        miss_str = f"  miss: [{', '.join(misses)}]" if misses else ""
        print(f"    {cat:>20s} {bar} {cat_acc:5.1f}%  ({correct}/{total}){miss_str}", flush=True)
    print(f"{'='*60}", flush=True)

    # Save report
    report_dir = script_dir / "reports"
    report_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = report_dir / f"efficientnet_benchmark_{ts}.json"

    report = {
        "metadata": {
            "model": "efficientnet_b0",
            "pretrained": "imagenet",
            "strategy": "fine-tune-last-block",
            "evaluation": "leave-one-out",
            "epochs": args.epochs,
            "augmentation_factor": args.n_augment,
            "learning_rate": args.lr,
            "batch_size": args.batch_size,
            "device": device,
            "timestamp": datetime.now().isoformat(),
            "total_images": n,
            "total_time_s": round(total_time, 1),
        },
        "accuracy": {
            "alias": round(acc_alias, 2),
            "strict": round(acc_strict, 2),
            "correct_alias": correct_alias,
            "correct_strict": correct_strict,
            "total": n,
        },
        "per_category": {
            cat: {
                "accuracy": round(per_cat_correct.get(cat, 0) / per_cat_total.get(cat, 1) * 100, 1),
                "correct": per_cat_correct.get(cat, 0),
                "total": per_cat_total.get(cat, 0),
                "misses": per_cat_misses.get(cat, []),
            }
            for cat in CATEGORIES
            if per_cat_total.get(cat, 0) > 0
        },
        "results": results,
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\nReport saved to: {report_path}", flush=True)

    return acc_alias

def train_final_model(script_dir, args):
    """Train final production model on ALL images and save weights."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n{'='*60}", flush=True)
    print(f"  Training FINAL Production Model", flush=True)
    print(f"  Device: {device} | Epochs: {args.epochs * 2} | Aug: {args.n_augment}x", flush=True)
    print(f"{'='*60}\n", flush=True)

    paths, labels, ids, meta = load_benchmark(script_dir)
    n = len(paths)
    print(f"Training on ALL {n} images", flush=True)

    # Train with more epochs for final model
    train_ds = DisasterDataset(paths, labels, transform=train_transform, n_augment=args.n_augment)
    train_loader = DataLoader(
        train_ds, batch_size=args.batch_size, shuffle=True,
        num_workers=0, pin_memory=True, drop_last=True,
    )

    model = create_model(num_classes=len(CATEGORIES), device=device)
    final_epochs = args.epochs * 2  # Double epochs for final model

    print(f"Training for {final_epochs} epochs...", flush=True)
    loss, train_acc = train_one_fold(model, train_loader, device, epochs=final_epochs, lr=args.lr)
    print(f"Final training loss: {loss:.4f}, accuracy: {train_acc*100:.1f}%", flush=True)

    # Save model
    model_dir = script_dir / "model_registry"
    model_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_path = model_dir / f"efficientnet_b0_disaster_{ts}.pth"

    torch.save({
        "model_state_dict": model.state_dict(),
        "categories": CATEGORIES,
        "cat_to_idx": CAT_TO_IDX,
        "type_aliases": {k: list(v) for k, v in TYPE_ALIASES.items()},
        "training": {
            "epochs": final_epochs,
            "augmentation": args.n_augment,
            "n_images": n,
            "lr": args.lr,
            "train_loss": loss,
            "train_acc": train_acc,
            "timestamp": datetime.now().isoformat(),
        },
    }, model_path)

    print(f"\nModel saved to: {model_path}", flush=True)
    print(f"Size: {model_path.stat().st_size / 1024 / 1024:.1f} MB", flush=True)
    return model_path

# Main

def main():
    parser = argparse.ArgumentParser(description="AEGIS EfficientNet Disaster Classifier")
    parser.add_argument("--epochs", type=int, default=15, help="Training epochs per fold")
    parser.add_argument("--lr", type=float, default=1e-3, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--n-augment", type=int, default=80, help="Augmentation factor per image")
    parser.add_argument("--train-final", action="store_true", help="Train final production model")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent.parent

    if args.train_final:
        train_final_model(script_dir, args)
    else:
        run_loo_benchmark(script_dir, args)

if __name__ == "__main__":
    main()
