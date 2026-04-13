"""
Fine-tune OpenCLIP ViT-B-32 for AEGIS disaster image classification.

Phase 1 goals implemented here:
- Fine-tune vision encoder only (text encoder frozen)
- Use contrastive objective with AEGIS 9-class prompts
- Train with AdamW + cosine LR schedule
- Weights & Biases logging (optional but enabled by default)
- Checkpointing (best + last)
- Per-epoch validation on:
  1) AEGIS 42-image benchmark
  2) Held-out CrisisMMD split from unified manifest

Input expected:
  ai-engine/data/crisis/processed/unified_manifest.csv
Built by:
  scripts/data/download_crisis_datasets.py
"""

from __future__ import annotations

import argparse
import importlib
import json
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path

try:
    import numpy as np
    import pandas as pd
except ImportError:
    sys.exit("Missing dependencies: numpy, pandas")

try:
    import torch
    import torch.nn.functional as F
    from torch import nn
    from torch.optim import AdamW
    from torch.optim.lr_scheduler import CosineAnnealingLR
    from torch.utils.data import DataLoader, Dataset
except ImportError:
    sys.exit("Missing dependency: torch")

try:
    from PIL import Image
except ImportError:
    sys.exit("Missing dependency: pillow")

try:
    import open_clip
except ImportError:
    sys.exit("Missing dependency: open-clip-torch")


AI_ENGINE_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = AI_ENGINE_ROOT / "data" / "crisis"
MANIFEST_PATH = DATA_ROOT / "processed" / "unified_manifest.csv"
AEGIS_42_PATH = DATA_ROOT / "aegis_benchmark.csv"
DEFAULT_OUTPUT_DIR = AI_ENGINE_ROOT / "models" / "clip_aegis_v1"
LEGACY_REGISTRY_DIR = AI_ENGINE_ROOT / "model_registry" / "clip"

SEED = 42

AEGIS_CLASS_PROMPTS = {
    "wildfire": "a disaster scene with wildfire flames and smoke",
    "flood": "a disaster scene with flood water affecting roads or buildings",
    "earthquake": "a disaster scene with earthquake impact or collapse",
    "storm": "a disaster scene caused by severe storm, hurricane, or tornado",
    "landslide": "a disaster scene with landslide, mudslide, or slope failure",
    "drought": "a drought scene with dry cracked land and scarce water",
    "structural_damage": "a scene with damaged buildings or infrastructure",
    "heatwave": "a heatwave scene with signs of extreme heat conditions",
    "safe": "a normal safe scene without disaster",
}

CLASS_ORDER = list(AEGIS_CLASS_PROMPTS.keys())
CLASS_TO_ID = {label: idx for idx, label in enumerate(CLASS_ORDER)}


@dataclass
class Metrics:
    top1: float
    top3: float
    n: int


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


class ContrastiveManifestDataset(Dataset):
    def __init__(self, df: pd.DataFrame, preprocess, tokenizer) -> None:
        self.df = df.reset_index(drop=True)
        self.preprocess = preprocess
        self.tokenizer = tokenizer

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        image_path = Path(str(row["image_path"]))
        label = str(row["label_9"]).strip().lower()

        if label not in AEGIS_CLASS_PROMPTS:
            label = "safe"

        try:
            img = Image.open(image_path).convert("RGB")
            image_tensor = self.preprocess(img)
        except Exception:
            image_tensor = torch.zeros(3, 224, 224)

        text_tokens = self.tokenizer([AEGIS_CLASS_PROMPTS[label]])[0]
        label_id = CLASS_TO_ID[label]
        return image_tensor, text_tokens, label_id


class EvalImageDataset(Dataset):
    def __init__(self, df: pd.DataFrame, preprocess) -> None:
        self.df = df.reset_index(drop=True)
        self.preprocess = preprocess

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        image_path = Path(str(row["image_path"]))
        label = str(row["label_9"]).strip().lower()
        label_id = CLASS_TO_ID.get(label, CLASS_TO_ID["safe"])

        try:
            img = Image.open(image_path).convert("RGB")
            image_tensor = self.preprocess(img)
        except Exception:
            image_tensor = torch.zeros(3, 224, 224)

        return image_tensor, label_id


def _infonce_loss(image_features: torch.Tensor, text_features: torch.Tensor, logit_scale: torch.Tensor) -> torch.Tensor:
    image_features = F.normalize(image_features, dim=-1)
    text_features = F.normalize(text_features, dim=-1)
    logits_per_image = logit_scale.exp() * image_features @ text_features.t()
    logits_per_text = logits_per_image.t()
    targets = torch.arange(image_features.size(0), device=image_features.device)
    loss_i = F.cross_entropy(logits_per_image, targets)
    loss_t = F.cross_entropy(logits_per_text, targets)
    return 0.5 * (loss_i + loss_t)


def _read_manifest(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Manifest missing at {path}. Run scripts/data/download_crisis_datasets.py first."
        )
    df = pd.read_csv(path)
    required_cols = {"source", "split", "image_path", "label_9"}
    missing = required_cols.difference(df.columns)
    if missing:
        raise ValueError(f"Manifest is missing required columns: {sorted(missing)}")

    df = df.copy()
    df["label_9"] = df["label_9"].astype(str).str.strip().str.lower()
    df = df[df["label_9"].isin(CLASS_ORDER)].copy()
    df = df[df["image_path"].map(lambda p: Path(str(p)).exists())].copy()
    return df.reset_index(drop=True)


def _prepare_splits(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    # Held-out eval set: CrisisMMD test split only.
    crisismmd_test = df[(df["source"] == "crisismmd") & (df["split"].isin(["test"]))].copy()

    # Train set: all train rows plus non-crisismmd rows that default to train.
    train_df = df[df["split"].isin(["train"])].copy()

    if len(train_df) == 0:
        raise RuntimeError("No training rows found in unified manifest.")

    return train_df.reset_index(drop=True), crisismmd_test.reset_index(drop=True)


def _load_aegis_42(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["image_path", "label_9"])

    df = pd.read_csv(path)

    label_col = None
    for candidate in ["label", "label_9", "class", "category"]:
        if candidate in df.columns:
            label_col = candidate
            break

    if label_col is None:
        return pd.DataFrame(columns=["image_path", "label_9"])

    if "image_path" not in df.columns:
        return pd.DataFrame(columns=["image_path", "label_9"])

    out = pd.DataFrame(
        {
            "image_path": df["image_path"].astype(str),
            "label_9": df[label_col].astype(str).str.strip().str.lower(),
        }
    )

    # Resolve relative paths against data root.
    def resolve_img(p: str) -> str:
        pp = Path(p)
        if pp.is_absolute():
            return str(pp)
        cand = DATA_ROOT / p
        if cand.exists():
            return str(cand)
        return str(pp)

    out["image_path"] = out["image_path"].map(resolve_img)
    out = out[out["label_9"].isin(CLASS_ORDER)]
    out = out[out["image_path"].map(lambda p: Path(p).exists())]
    return out.reset_index(drop=True)


@torch.no_grad()
def evaluate_classifier(
    model,
    preprocess,
    tokenizer,
    eval_df: pd.DataFrame,
    device: torch.device,
    batch_size: int,
) -> Metrics:
    if eval_df.empty:
        return Metrics(top1=0.0, top3=0.0, n=0)

    ds = EvalImageDataset(eval_df, preprocess)
    loader = DataLoader(ds, batch_size=batch_size, shuffle=False, num_workers=2, pin_memory=True)

    prompts = [AEGIS_CLASS_PROMPTS[c] for c in CLASS_ORDER]
    text_tokens = tokenizer(prompts).to(device)
    text_features = model.encode_text(text_tokens)
    text_features = F.normalize(text_features, dim=-1)

    total = 0
    top1 = 0
    top3 = 0

    for images, labels in loader:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)

        image_features = model.encode_image(images)
        image_features = F.normalize(image_features, dim=-1)

        logits = image_features @ text_features.t()
        probs = logits.softmax(dim=-1)

        pred1 = probs.argmax(dim=-1)
        pred3 = probs.topk(k=min(3, probs.shape[1]), dim=-1).indices

        total += labels.numel()
        top1 += (pred1 == labels).sum().item()
        top3 += (pred3 == labels.unsqueeze(1)).any(dim=1).sum().item()

    return Metrics(
        top1=float(top1 / max(total, 1)),
        top3=float(top3 / max(total, 1)),
        n=int(total),
    )


def _freeze_text_encoder(model: nn.Module) -> None:
    # OpenCLIP text side names can vary slightly; freeze robustly.
    text_attr_names = ["transformer", "token_embedding", "positional_embedding", "ln_final", "text_projection"]
    for name in text_attr_names:
        module_or_tensor = getattr(model, name, None)
        if module_or_tensor is None:
            continue
        if isinstance(module_or_tensor, nn.Module):
            for p in module_or_tensor.parameters():
                p.requires_grad_(False)
        elif torch.is_tensor(module_or_tensor):
            module_or_tensor.requires_grad = False

    # Keep vision encoder trainable.
    for p in model.visual.parameters():
        p.requires_grad_(True)

    if hasattr(model, "logit_scale"):
        model.logit_scale.requires_grad = True


def _save_checkpoint(
    path: Path,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler: torch.optim.lr_scheduler._LRScheduler,
    scaler: torch.cuda.amp.GradScaler,
    epoch: int,
    best_score: float,
) -> None:
    payload = {
        "epoch": epoch,
        "best_score": best_score,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "scheduler_state": scheduler.state_dict(),
        "scaler_state": scaler.state_dict(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(payload, path)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fine-tune CLIP ViT-B-32 for AEGIS")
    p.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    p.add_argument("--aegis42", type=Path, default=AEGIS_42_PATH)
    p.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    p.add_argument("--legacy-registry-dir", type=Path, default=LEGACY_REGISTRY_DIR)
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--grad-accum", type=int, default=1)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--weight-decay", type=float, default=0.01)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--resume", type=Path, default=None)
    p.add_argument("--no-wandb", action="store_true")
    p.add_argument("--wandb-project", type=str, default="aegis-clip-finetune")
    p.add_argument("--wandb-run-name", type=str, default="clip_vitb32_phase1")
    return p.parse_args()


def train() -> None:
    args = parse_args()
    set_seed(args.seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    use_amp = device.type == "cuda"

    print(f"Device: {device}")
    print(f"Manifest: {args.manifest}")

    manifest_df = _read_manifest(args.manifest)
    train_df, crisismmd_test_df = _prepare_splits(manifest_df)
    aegis42_df = _load_aegis_42(args.aegis42)

    print(f"Train rows: {len(train_df):,}")
    print(f"CrisisMMD held-out rows: {len(crisismmd_test_df):,}")
    print(f"AEGIS 42 rows: {len(aegis42_df):,}")

    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model = model.to(device)

    _freeze_text_encoder(model)

    train_ds = ContrastiveManifestDataset(train_df, preprocess, tokenizer)
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=(device.type == "cuda"),
        drop_last=True,
    )

    optimizer = AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=args.lr,
        weight_decay=args.weight_decay,
    )
    scheduler = CosineAnnealingLR(optimizer, T_max=max(args.epochs, 1), eta_min=args.lr * 0.1)
    scaler = torch.cuda.amp.GradScaler(enabled=use_amp)

    start_epoch = 1
    best_score = -1.0

    best_ckpt = args.output_dir / "clip_vitb32_best.pt"
    last_ckpt = args.output_dir / "clip_vitb32_last.pt"
    metadata_path = args.output_dir / "training_metrics.json"

    if args.resume and args.resume.exists():
        ckpt = torch.load(args.resume, map_location=device)
        model.load_state_dict(ckpt["model_state"], strict=True)
        optimizer.load_state_dict(ckpt["optimizer_state"])
        scheduler.load_state_dict(ckpt["scheduler_state"])
        scaler.load_state_dict(ckpt["scaler_state"])
        start_epoch = int(ckpt.get("epoch", 0)) + 1
        best_score = float(ckpt.get("best_score", -1.0))
        print(f"Resumed from epoch {start_epoch - 1}")

    wandb_run = None
    if not args.no_wandb:
        try:
            wandb = importlib.import_module("wandb")

            wandb_run = wandb.init(
                project=args.wandb_project,
                name=args.wandb_run_name,
                config={
                    "epochs": args.epochs,
                    "batch_size": args.batch_size,
                    "grad_accum": args.grad_accum,
                    "lr": args.lr,
                    "weight_decay": args.weight_decay,
                    "seed": args.seed,
                },
            )
        except Exception as exc:
            print(f"W&B init failed; continuing without W&B: {exc}")
            wandb_run = None

    history: list[dict] = []

    for epoch in range(start_epoch, args.epochs + 1):
        model.train()
        epoch_start = time.time()
        running_loss = 0.0
        n_steps = 0

        optimizer.zero_grad(set_to_none=True)

        for step, batch in enumerate(train_loader, start=1):
            images, text_tokens, _ = batch
            images = images.to(device, non_blocking=True)
            text_tokens = text_tokens.to(device, non_blocking=True)

            with torch.cuda.amp.autocast(enabled=use_amp):
                image_features = model.encode_image(images)
                text_features = model.encode_text(text_tokens)
                loss = _infonce_loss(image_features, text_features, model.logit_scale)
                loss = loss / max(args.grad_accum, 1)

            scaler.scale(loss).backward()

            if step % args.grad_accum == 0:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(
                    [p for p in model.parameters() if p.requires_grad],
                    max_norm=1.0,
                )
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)

            running_loss += loss.item() * max(args.grad_accum, 1)
            n_steps += 1

        scheduler.step()

        train_loss = float(running_loss / max(n_steps, 1))

        model.eval()
        aegis_metrics = evaluate_classifier(
            model=model,
            preprocess=preprocess,
            tokenizer=tokenizer,
            eval_df=aegis42_df,
            device=device,
            batch_size=min(args.batch_size, 32),
        )
        crisismmd_metrics = evaluate_classifier(
            model=model,
            preprocess=preprocess,
            tokenizer=tokenizer,
            eval_df=crisismmd_test_df,
            device=device,
            batch_size=min(args.batch_size, 64),
        )

        score = float(aegis_metrics.top1 + 0.5 * crisismmd_metrics.top1)

        epoch_row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "aegis42_top1": aegis_metrics.top1,
            "aegis42_top3": aegis_metrics.top3,
            "aegis42_n": aegis_metrics.n,
            "crisismmd_top1": crisismmd_metrics.top1,
            "crisismmd_top3": crisismmd_metrics.top3,
            "crisismmd_n": crisismmd_metrics.n,
            "score": score,
            "epoch_seconds": round(time.time() - epoch_start, 2),
            "lr": float(optimizer.param_groups[0]["lr"]),
        }
        history.append(epoch_row)

        print(
            f"Epoch {epoch:02d}/{args.epochs} | "
            f"loss={train_loss:.4f} | "
            f"AEGIS42 top1={aegis_metrics.top1:.4f} top3={aegis_metrics.top3:.4f} | "
            f"CrisisMMD top1={crisismmd_metrics.top1:.4f} top3={crisismmd_metrics.top3:.4f}"
        )

        if wandb_run is not None:
            wandb_run.log(epoch_row)

        _save_checkpoint(last_ckpt, model, optimizer, scheduler, scaler, epoch, best_score)

        if score > best_score:
            best_score = score
            _save_checkpoint(best_ckpt, model, optimizer, scheduler, scaler, epoch, best_score)

            # Also write pure state dict for easier loading in services.
            state_dict_path = args.output_dir / "clip_aegis_v1_state_dict.pt"
            state_dict_path.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), state_dict_path)

            # Compatibility copy for existing registry consumers.
            args.legacy_registry_dir.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), args.legacy_registry_dir / "clip_crisis_vit_b32.pt")

    metadata = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seed": args.seed,
        "model": "ViT-B-32",
        "pretrained": "openai",
        "train_rows": int(len(train_df)),
        "heldout_rows": int(len(crisismmd_test_df)),
        "aegis42_rows": int(len(aegis42_df)),
        "best_score": best_score,
        "output_dir": str(args.output_dir),
        "legacy_registry_dir": str(args.legacy_registry_dir),
        "class_order": CLASS_ORDER,
        "history": history,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\nTraining complete.")
    print(f"Best checkpoint: {best_ckpt}")
    print(f"Last checkpoint: {last_ckpt}")
    print(f"Metadata: {metadata_path}")

    if wandb_run is not None:
        wandb_run.finish()


if __name__ == "__main__":
    train()
