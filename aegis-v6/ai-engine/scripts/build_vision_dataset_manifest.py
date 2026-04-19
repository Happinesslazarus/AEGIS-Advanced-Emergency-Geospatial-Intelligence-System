"""
Build_vision_dataset_manifest AI engine module.
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "vision_dataset_sources.json"
OUTPUT_CSV = ROOT / "data" / "vision_dataset_manifest.csv"
OUTPUT_JSONL = ROOT / "data" / "vision_dataset_manifest.jsonl"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
EXTERNAL_DATASET_ROOT = os.environ.get("AEGIS_VISION_DATASET_ROOT")

@dataclass
class ManifestRow:
    source_id: str
    split: str
    label: str
    image_path: str
    domain: str
    role: str
    license: str
    original_label: str
    metadata_json: str

def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)

def normalize_label(value: str) -> str:
    return value.strip().lower().replace(" ", "_").replace("-", "_")

def resolve_source_path(relative_path: str) -> Path:
    raw_path = Path(relative_path)
    if raw_path.is_absolute():
        return raw_path.resolve()

    if EXTERNAL_DATASET_ROOT and relative_path.startswith("datasets/"):
        suffix = relative_path.split("/", 1)[1]
        return (Path(EXTERNAL_DATASET_ROOT) / suffix).resolve()

    return (ROOT / raw_path).resolve()

def iter_benchmark_json(source: dict[str, Any]) -> Iterable[ManifestRow]:
    annotation_path = resolve_source_path(source["annotation_path"])
    image_root = resolve_source_path(source["image_root"])

    with annotation_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    items = payload.get("benchmark", [])
    for item in items:
        image_id = item["id"]
        expected_type = normalize_label(item["expected_type"])

        image_path = None
        for ext in (".jpg", ".png", ".jpeg", ".webp"):
            candidate = image_root / f"{image_id}{ext}"
            if candidate.exists():
                image_path = candidate
                break

        if image_path is None:
            continue

        metadata = {
            "id": image_id,
            "source_type": "benchmark_json",
            "notes": item.get("notes"),
        }

        yield ManifestRow(
            source_id=source["source_id"],
            split="benchmark",
            label=expected_type,
            image_path=str(image_path),
            domain=source["domain"],
            role=source["role"],
            license=source["license"],
            original_label=expected_type,
            metadata_json=json.dumps(metadata, ensure_ascii=True),
        )

def iter_folder_by_class(source: dict[str, Any]) -> Iterable[ManifestRow]:
    image_root = resolve_source_path(source["image_root"])
    if not image_root.exists():
        return

    for split_dir in sorted(p for p in image_root.iterdir() if p.is_dir()):
        split_name = normalize_label(split_dir.name)
        child_dirs = [p for p in split_dir.iterdir() if p.is_dir()]

        if child_dirs:
            for label_dir in sorted(child_dirs):
                label = normalize_label(label_dir.name)
                for image_path in sorted(label_dir.rglob("*")):
                    if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
                        yield ManifestRow(
                            source_id=source["source_id"],
                            split=split_name,
                            label=label,
                            image_path=str(image_path.resolve()),
                            domain=source["domain"],
                            role=source["role"],
                            license=source["license"],
                            original_label=label_dir.name,
                            metadata_json=json.dumps(
                                {
                                    "source_type": "folder_by_class",
                                    "relative_path": str(image_path.relative_to(image_root)),
                                },
                                ensure_ascii=True,
                            ),
                        )
        else:
            label = normalize_label(split_dir.name)
            for image_path in sorted(split_dir.rglob("*")):
                if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
                    yield ManifestRow(
                        source_id=source["source_id"],
                        split="unspecified",
                        label=label,
                        image_path=str(image_path.resolve()),
                        domain=source["domain"],
                        role=source["role"],
                        license=source["license"],
                        original_label=split_dir.name,
                        metadata_json=json.dumps(
                            {
                                "source_type": "folder_by_class",
                                "relative_path": str(image_path.relative_to(image_root)),
                            },
                            ensure_ascii=True,
                        ),
                    )

def build_rows(config: dict[str, Any]) -> list[ManifestRow]:
    rows: list[ManifestRow] = []
    for source in config.get("sources", []):
        ingestion_type = source.get("ingestion_type")
        if ingestion_type == "benchmark_json":
            rows.extend(iter_benchmark_json(source))
        elif ingestion_type == "folder_by_class":
            rows.extend(iter_folder_by_class(source))
        else:
            raise ValueError(f"Unsupported ingestion_type: {ingestion_type}")
    return rows

def write_outputs(rows: list[ManifestRow]) -> None:
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "source_id",
        "split",
        "label",
        "image_path",
        "domain",
        "role",
        "license",
        "original_label",
        "metadata_json",
    ]

    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.__dict__)

    with OUTPUT_JSONL.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row.__dict__, ensure_ascii=True) + "\n")

def summarize(rows: list[ManifestRow]) -> None:
    by_source: dict[str, int] = {}
    by_label: dict[str, int] = {}
    for row in rows:
        by_source[row.source_id] = by_source.get(row.source_id, 0) + 1
        by_label[row.label] = by_label.get(row.label, 0) + 1

    print("AEGIS vision dataset manifest built")
    print(f"rows: {len(rows)}")
    print("by_source:")
    for key in sorted(by_source):
        print(f"  {key}: {by_source[key]}")
    print("by_label:")
    for key in sorted(by_label):
        print(f"  {key}: {by_label[key]}")
    print(f"csv: {OUTPUT_CSV}")
    print(f"jsonl: {OUTPUT_JSONL}")
    if EXTERNAL_DATASET_ROOT:
        print(f"dataset_root_override: {EXTERNAL_DATASET_ROOT}")

def main() -> None:
    config = load_config()
    rows = build_rows(config)
    write_outputs(rows)
    summarize(rows)

if __name__ == "__main__":
    main()
