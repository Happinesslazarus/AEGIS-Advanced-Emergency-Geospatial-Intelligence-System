"""
Download and prepare crisis vision datasets for AEGIS CLIP fine-tuning.

This script does three things:
1) Downloads datasets that are openly accessible (when links are available).
2) Creates placeholders and instructions for gated datasets.
3) Builds a unified 9-class training manifest consumed by training/finetune_clip.py.

Primary output:
  ai-engine/data/crisis/processed/unified_manifest.csv

Usage:
  python scripts/data/download_crisis_datasets.py
  python scripts/data/download_crisis_datasets.py --skip-download
  python scripts/data/download_crisis_datasets.py --data-root E:/datasets/aegis_crisis
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    import pandas as pd
except ImportError:
    sys.exit("Missing dependency: pandas. Install with: pip install pandas")

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: requests. Install with: pip install requests")

try:
    from tqdm import tqdm
except ImportError:
    sys.exit("Missing dependency: tqdm. Install with: pip install tqdm")


AI_ENGINE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_ROOT = AI_ENGINE_ROOT / "data" / "crisis"

AEGIS_9_CLASSES = {
    "wildfire",
    "flood",
    "earthquake",
    "storm",
    "landslide",
    "drought",
    "structural_damage",
    "heatwave",
    "safe",
}


@dataclass
class DatasetSpec:
    name: str
    mode: str  # "auto" or "manual"
    urls: list[str]
    extract_subdir: str
    notes: str


DATASET_SPECS: dict[str, DatasetSpec] = {
    "crisismmd": DatasetSpec(
        name="crisismmd",
        mode="auto",
        urls=[
            # Official host can be intermittent; fallback mirrors can be appended by user.
            "https://crisisnlp.qcri.org/data/crisismmd/CrisisMMD_v2.0.zip",
        ],
        extract_subdir="raw/crisismmd",
        notes="CrisisMMD v2.0 multimodal disaster dataset",
    ),
    "aider": DatasetSpec(
        name="aider",
        mode="auto",
        urls=[
            "https://github.com/ioannismesionis/AIDER/releases/download/v1.0/AIDER.zip",
            "https://github.com/AdeelH/pytorch-multi-task-learning/releases/download/v1.0/AIDER.zip",
        ],
        extract_subdir="raw/aider",
        notes="AIDER aerial disaster image dataset",
    ),
    "incidents1m": DatasetSpec(
        name="incidents1m",
        mode="manual",
        urls=["http://incidentsdataset.csail.mit.edu/"],
        extract_subdir="external/incidents1m",
        notes="Access request required. Place extracted files in external/incidents1m",
    ),
    "xbd": DatasetSpec(
        name="xbd",
        mode="manual",
        urls=["https://xview2.org/dataset"],
        extract_subdir="external/xbd",
        notes="Registration required. Place extracted files in external/xbd",
    ),
    "medic": DatasetSpec(
        name="medic",
        mode="manual",
        urls=["https://github.com/huggingface/medic"],
        extract_subdir="external/medic",
        notes="Place MEDIC images/metadata in external/medic",
    ),
}


def ensure_layout(data_root: Path) -> None:
    for rel in ["raw", "external", "processed", "manifests", "logs"]:
        (data_root / rel).mkdir(parents=True, exist_ok=True)


def stream_download(url: str, dest_zip: Path, timeout_s: int = 60) -> None:
    with requests.get(url, stream=True, timeout=timeout_s) as response:
        response.raise_for_status()
        total = int(response.headers.get("Content-Length", 0))
        with open(dest_zip, "wb") as f, tqdm(
            total=total,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            desc=f"Downloading {dest_zip.name}",
        ) as pbar:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                pbar.update(len(chunk))


def try_download_and_extract(spec: DatasetSpec, data_root: Path, force: bool) -> dict:
    target_dir = data_root / spec.extract_subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    marker = target_dir / ".ready"
    if marker.exists() and not force:
        return {"status": "skipped", "reason": "already prepared", "target_dir": str(target_dir)}

    if spec.mode == "manual":
        write_manual_placeholder(spec, data_root)
        return {"status": "manual", "reason": "gated dataset", "target_dir": str(target_dir)}

    errors: list[str] = []
    tmp_zip = data_root / "raw" / f"{spec.name}.zip"

    for url in spec.urls:
        try:
            stream_download(url, tmp_zip)
            with zipfile.ZipFile(tmp_zip, "r") as zf:
                zf.extractall(target_dir)
            marker.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), encoding="utf-8")
            try:
                tmp_zip.unlink(missing_ok=True)
            except Exception:
                pass
            return {"status": "ok", "url": url, "target_dir": str(target_dir)}
        except Exception as exc:
            errors.append(f"{url}: {exc}")

    write_manual_placeholder(spec, data_root)
    return {
        "status": "failed",
        "reason": "all URLs failed, manual placement required",
        "errors": errors,
        "target_dir": str(target_dir),
    }


def write_manual_placeholder(spec: DatasetSpec, data_root: Path) -> None:
    target_dir = data_root / spec.extract_subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    readme = target_dir / "README.md"
    if readme.exists():
        return
    lines = [
        f"# {spec.name}",
        "",
        "This dataset is gated/manual.",
        "",
        "Where to request/download:",
    ]
    for u in spec.urls:
        lines.append(f"- {u}")
    lines.extend(
        [
            "",
            "Placement:",
            f"- Put extracted files under: {target_dir}",
            "",
            "Notes:",
            f"- {spec.notes}",
        ]
    )
    readme.write_text("\n".join(lines), encoding="utf-8")


def _build_image_index(root: Path) -> dict[str, Path]:
    """Map basename (and stem) to image file for fast fallback lookup."""
    index: dict[str, Path] = {}
    if not root.exists():
        return index
    for p in root.rglob("*"):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        index[p.name] = p
        index[p.stem] = p
    return index


def _map_to_aegis_9(raw_label: str) -> str | None:
    s = raw_label.strip().lower()

    mapping = {
        # CrisisMMD and related labels
        "flood": "flood",
        "wildfire": "wildfire",
        "fire": "wildfire",
        "earthquake": "earthquake",
        "hurricane": "storm",
        "tornado": "storm",
        "storm": "storm",
        "drought": "drought",
        "landslide": "landslide",
        "infrastructure_and_utility_damage": "structural_damage",
        "vehicle_damage": "structural_damage",
        "other_relevant_information": "safe",
        "rescue_volunteering_or_donation_effort": "safe",
        "affected_injured_or_dead_people": "safe",
        "not_humanitarian": "safe",
        "safe": "safe",
        "normal": "safe",
        "non_disaster": "safe",
        "none": "safe",
        # AIDER folder conventions
        "firedisaster": "wildfire",
        "flooddisaster": "flood",
        "earthquakedisaster": "earthquake",
        "collapsedbuilding": "structural_damage",
    }

    if s in mapping:
        return mapping[s]

    if "heat" in s or "heatwave" in s:
        return "heatwave"
    if "struct" in s or "building" in s or "damage" in s:
        return "structural_damage"
    if "safe" in s or "normal" in s:
        return "safe"

    return None


def _resolve_crisismmd_image_path(
    base_dir: Path,
    image_index: dict[str, Path],
    image_path_raw: str,
    image_id_raw: str,
) -> Path | None:
    cands: list[Path] = []

    if image_path_raw:
        cands.append(base_dir / image_path_raw)

    if image_id_raw:
        cands.append(base_dir / image_id_raw)
        cands.append(base_dir / f"{image_id_raw}.jpg")
        cands.append(base_dir / f"{image_id_raw}.jpeg")
        cands.append(base_dir / f"{image_id_raw}.png")

    for p in cands:
        if p.exists() and p.is_file():
            return p

    if image_path_raw and image_path_raw in image_index:
        return image_index[image_path_raw]

    if image_id_raw and image_id_raw in image_index:
        return image_index[image_id_raw]

    if image_path_raw:
        bn = Path(image_path_raw).name
        return image_index.get(bn)

    return None


def build_crisismmd_manifest(data_root: Path) -> pd.DataFrame:
    source_root = data_root / "raw" / "crisismmd"
    if not source_root.exists():
        return pd.DataFrame()

    image_index = _build_image_index(source_root)
    tsv_files = sorted(source_root.rglob("*task_humanitarian_text_img*.tsv"))
    rows: list[dict] = []

    for tsv in tsv_files:
        split = "train"
        name = tsv.name.lower()
        if "dev" in name or "val" in name:
            split = "val"
        elif "test" in name:
            split = "test"

        with open(tsv, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f, delimiter="\t")
            for rec in reader:
                if not rec:
                    continue

                tweet_text = rec[2] if len(rec) > 2 else ""
                raw_label = rec[3] if len(rec) > 3 else ""
                image_id = rec[1] if len(rec) > 1 else ""
                image_path_field = rec[5] if len(rec) > 5 else ""

                label_9 = _map_to_aegis_9(raw_label)
                if label_9 is None:
                    continue

                resolved = _resolve_crisismmd_image_path(
                    source_root, image_index, image_path_field, image_id
                )
                if resolved is None:
                    continue

                rows.append(
                    {
                        "source": "crisismmd",
                        "split": split,
                        "image_path": str(resolved),
                        "text": tweet_text,
                        "raw_label": raw_label,
                        "label_9": label_9,
                    }
                )

    return pd.DataFrame(rows)


def build_aider_manifest(data_root: Path) -> pd.DataFrame:
    source_root = data_root / "raw" / "aider"
    if not source_root.exists():
        return pd.DataFrame()

    rows: list[dict] = []
    for img in source_root.rglob("*"):
        if img.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue

        raw_label = img.parent.name
        label_9 = _map_to_aegis_9(raw_label)
        if label_9 is None:
            continue

        rows.append(
            {
                "source": "aider",
                "split": "train",
                "image_path": str(img),
                "text": raw_label,
                "raw_label": raw_label,
                "label_9": label_9,
            }
        )

    return pd.DataFrame(rows)


def write_per_source_manifests(data_root: Path, frames: dict[str, pd.DataFrame]) -> None:
    out_dir = data_root / "manifests"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, df in frames.items():
        out_path = out_dir / f"{name}_manifest.csv"
        if df.empty:
            continue
        df.to_csv(out_path, index=False)


def write_unified_manifest(data_root: Path, frames: Iterable[pd.DataFrame]) -> Path:
    out_dir = data_root / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "unified_manifest.csv"

    valid_frames = [f for f in frames if not f.empty]
    if not valid_frames:
        empty = pd.DataFrame(
            columns=["source", "split", "image_path", "text", "raw_label", "label_9"]
        )
        empty.to_csv(out_path, index=False)
        return out_path

    unified = pd.concat(valid_frames, ignore_index=True)
    unified = unified[unified["label_9"].isin(AEGIS_9_CLASSES)].copy()
    unified = unified.drop_duplicates(subset=["source", "image_path", "label_9"])
    unified = unified.sample(frac=1.0, random_state=42).reset_index(drop=True)

    unified.to_csv(out_path, index=False)
    return out_path


def _create_synthetic_fallback(data_root: Path) -> pd.DataFrame:
    """
    Generate minimal synthetic labeled placeholder images using PIL.

    Creates 50 solid-colour images per crisis class so the fine-tuning
    pipeline can run end-to-end even when no real imagery is available.
    Images are visually distinct (different hue/saturation) per class.
    """
    try:
        from PIL import Image, ImageDraw  # type: ignore[import]
    except ImportError:
        return pd.DataFrame()

    class_colours = {
        "flood":              (30, 100, 200),
        "wildfire":           (220, 80, 20),
        "earthquake":         (130, 90, 50),
        "storm":              (80, 80, 140),
        "landslide":          (100, 70, 40),
        "drought":            (200, 170, 80),
        "structural_damage":  (150, 50, 50),
        "heatwave":           (220, 130, 30),
        "safe":               (60, 160, 60),
    }

    img_dir = data_root / "raw" / "synthetic"
    img_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    n_per_class = 50

    for cls, base_rgb in class_colours.items():
        for i in range(n_per_class):
            # Slightly vary brightness so images are not identical
            factor = 0.7 + 0.6 * (i / n_per_class)
            rgb = tuple(min(255, int(c * factor)) for c in base_rgb)
            img = Image.new("RGB", (224, 224), rgb)  # type: ignore[arg-type]
            draw = ImageDraw.Draw(img)
            # add a simple diagonal stripe for visual variation
            for j in range(0, 224, 20):
                draw.line([(j, 0), (224, 224 - j)], fill=(255, 255, 255), width=2)

            img_path = img_dir / f"{cls}_{i:04d}.jpg"
            if not img_path.exists():
                img.save(str(img_path), "JPEG", quality=80)

            rows.append({
                "source": "synthetic",
                "split": "train" if i < 40 else "val",
                "image_path": str(img_path),
                "text": f"synthetic {cls} placeholder",
                "raw_label": cls,
                "label_9": cls,
            })

    print(f"  Created {len(rows):,} synthetic placeholder images in {img_dir}")
    return pd.DataFrame(rows)


def try_hf_download(data_root: Path) -> pd.DataFrame:
    """
    Attempt to download a disaster image dataset from Hugging Face Hub.
    Falls back to synthetic placeholder images if no real data is available.

    Returns a DataFrame with the same schema as build_crisismmd_manifest().
    """
    try:
        from datasets import load_dataset  # type: ignore[import]
    except ImportError:
        print("  datasets library not installed; skipping HF, using synthetic fallback.")
        return _create_synthetic_fallback(data_root)

    # Ordered list of known HF repos with disaster imagery.
    # Each entry: (repo_id, config_name, [label_column_candidates])
    # Note: large datasets (>100 MB) are excluded to avoid timeouts.
    hf_datasets: list[tuple[str, str, list[str]]] = [
        # shreyasivani0205 disaster project images (small, publicly accessible)
        (
            "shreyasivani0205/disaster-project-images",
            "default",
            ["label", "category", "disaster_type", "class"],
        ),
        # DisasterM3 (NeurIPS 2025) - uncomment if you have sufficient disk+bandwidth:
        # ("Kingdrone-Junjue/DisasterM3", "default",
        #  ["disaster_type", "disaster_category", "label", "category", "class", "hazard"]),
    ]

    img_dir = data_root / "raw" / "hf_crisis"
    img_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    for repo_id, config, label_candidates in hf_datasets:
        try:
            print(f"  Trying HuggingFace: {repo_id} ...")
            ds = load_dataset(repo_id, config, trust_remote_code=False)
            for split_name, split_ds in ds.items():
                if "image" not in split_ds.column_names:
                    continue
                label_col = next(
                    (c for c in label_candidates if c in split_ds.column_names),
                    None,
                )
                if label_col is None:
                    continue
                for i, sample in enumerate(tqdm(split_ds, desc=f"{repo_id}/{split_name}", unit="img")):
                    img = sample.get("image")
                    raw_lbl = str(sample.get(label_col, ""))
                    label_9 = _map_to_aegis_9(raw_lbl)
                    if label_9 is None or img is None:
                        continue
                    try:
                        img_path = img_dir / f"{repo_id.replace('/', '_')}_{split_name}_{i}.jpg"
                        if not img_path.exists():
                            img.save(str(img_path), "JPEG", quality=85)
                        rows.append({
                            "source": "hf_" + repo_id.split("/")[-1],
                            "split": split_name,
                            "image_path": str(img_path),
                            "text": raw_lbl,
                            "raw_label": raw_lbl,
                            "label_9": label_9,
                        })
                    except Exception:
                        continue
            if rows:
                print(f"  Downloaded {len(rows):,} images from {repo_id}")
                break  # stop after first successful source
        except Exception as exc:
            print(f"  {repo_id} failed: {exc}")
            continue

    if not rows:
        print("  No HF imagery found; generating synthetic placeholder dataset.")
        return _create_synthetic_fallback(data_root)

    return pd.DataFrame(rows)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download and prepare crisis datasets")
    p.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    p.add_argument("--force", action="store_true", help="Re-download and re-extract auto datasets")
    p.add_argument("--skip-download", action="store_true", help="Do not download; only build manifests from local files")
    p.add_argument("--hf", action="store_true", help="Try HuggingFace Hub as fallback source")
    p.add_argument("--only", nargs="*", default=[], help="Optional dataset names to process")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    data_root: Path = args.data_root
    ensure_layout(data_root)

    selected = set(args.only) if args.only else set(DATASET_SPECS.keys())
    invalid = selected.difference(DATASET_SPECS.keys())
    if invalid:
        raise ValueError(f"Unknown dataset keys: {sorted(invalid)}")

    download_results: dict[str, dict] = {}
    if not args.skip_download:
        for key in sorted(selected):
            spec = DATASET_SPECS[key]
            print(f"\n[{key}] {spec.notes}")
            result = try_download_and_extract(spec, data_root, force=args.force)
            download_results[key] = result
            print(f"  -> {result['status']}")
    else:
        print("Skipping download step as requested.")

    crisismmd_df = build_crisismmd_manifest(data_root) if "crisismmd" in selected else pd.DataFrame()
    aider_df = build_aider_manifest(data_root) if "aider" in selected else pd.DataFrame()

    # HuggingFace fallback if primary sources failed and --hf flag set
    hf_df = pd.DataFrame()
    if args.hf and crisismmd_df.empty and aider_df.empty:
        print("\n[hf_fallback] Trying HuggingFace Hub for crisis images ...")
        hf_df = try_hf_download(data_root)
        if not hf_df.empty:
            print(f"  HuggingFace: {len(hf_df):,} images loaded.")

    per_source = {
        "crisismmd": crisismmd_df,
        "aider": aider_df,
        "hf": hf_df,
    }
    write_per_source_manifests(data_root, per_source)

    unified_path = write_unified_manifest(data_root, [crisismmd_df, aider_df, hf_df])

    summary = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data_root": str(data_root),
        "download": download_results,
        "rows": {
            "crisismmd": int(len(crisismmd_df)),
            "aider": int(len(aider_df)),
            "hf": int(len(hf_df)),
            "unified_total": int(len(pd.read_csv(unified_path))),
        },
        "unified_manifest": str(unified_path),
        "manual_required": {
            k: DATASET_SPECS[k].urls for k in ["incidents1m", "xbd", "medic"]
        },
    }

    summary_path = data_root / "manifests" / "download_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\nDataset preparation complete.")
    print(f"Unified manifest: {unified_path}")
    print(f"Summary: {summary_path}")


if __name__ == "__main__":
    main()
