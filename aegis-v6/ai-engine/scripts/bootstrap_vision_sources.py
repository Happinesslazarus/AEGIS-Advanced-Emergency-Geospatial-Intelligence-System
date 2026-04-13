"""
Module: bootstrap_vision_sources.py

Bootstrap_vision_sources AI engine module.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tarfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "vision_dataset_sources.json"

def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

def detect_default_dataset_root() -> Path:
    preferred = Path("D:/aegis-datasets")
    if preferred.exists() or preferred.drive:
        return preferred
    return ROOT / "datasets"

def safe_slug(name: str) -> str:
    return name.strip().lower().replace(" ", "_").replace("-", "_")

def write_source_files(source_dir: Path, source: dict[str, Any]) -> None:
    source_dir.mkdir(parents=True, exist_ok=True)
    (source_dir / "_SOURCE.json").write_text(json.dumps(source, indent=2), encoding="utf-8")

    lines = [
        f"Source: {source['name']}",
        f"Source ID: {source['source_id']}",
        f"Role: {source['role']}",
        f"Domain: {source['domain']}",
        f"License: {source['license']}",
        f"Acquisition mode: {source.get('acquisition_mode', 'unknown')}",
        f"Requires registration: {source.get('requires_manual_registration', False)}",
    ]

    if source.get("source_url"):
        lines.append(f"Source URL: {source['source_url']}")
    if source.get("official_download_url"):
        lines.append(f"Download URL: {source['official_download_url']}")
    if source.get("expected_download_size_gb") is not None:
        lines.append(f"Expected size (GB): {source['expected_download_size_gb']}")

    lines.append("")
    lines.append("Notes:")
    for note in source.get("notes", []):
        lines.append(f"- {note}")

    if source.get("acquisition_mode") != "direct_download":
        lines.append("")
        lines.append("Action:")
        lines.append("- Download this source manually from the official URL.")
        lines.append("- Extract or organize files under this folder using split/label subfolders that match the AEGIS taxonomy.")

    (source_dir / "README.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

def download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response, dest.open("wb") as handle:
        shutil.copyfileobj(response, handle)

def maybe_extract(archive_path: Path, dest_dir: Path) -> None:
    lower = archive_path.name.lower()
    if lower.endswith(".zip"):
        with zipfile.ZipFile(archive_path, "r") as archive:
            archive.extractall(dest_dir)
        return

    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        with tarfile.open(archive_path, "r:gz") as archive:
            archive.extractall(dest_dir)

def download_named_asset(url: str, dest_root: Path, label: str, extract_archives: bool) -> dict[str, Any]:
    filename = url.rstrip("/").split("/")[-1]
    asset_dir = dest_root / label
    archive_path = asset_dir / filename
    download_file(url, archive_path)

    result: dict[str, Any] = {
        "label": label,
        "archive_path": str(archive_path),
        "downloaded": True,
    }

    if extract_archives:
        extract_dir = asset_dir / "_raw"
        extract_dir.mkdir(parents=True, exist_ok=True)
        try:
            maybe_extract(archive_path, extract_dir)
            result["extract_dir"] = str(extract_dir)
        except Exception as exc:
            result["extract_error"] = str(exc)

    return result

def bootstrap_sources(
    dataset_root: Path,
    download_ids: set[str],
    annotation_ids: set[str],
    extract_archives: bool,
) -> None:
    config = load_config()
    dataset_root.mkdir(parents=True, exist_ok=True)
    downloads_root = dataset_root / "_downloads"
    downloads_root.mkdir(parents=True, exist_ok=True)

    catalog = {
        "dataset_root": str(dataset_root),
        "sources": [],
    }

    for source in sorted(config.get("sources", []), key=lambda item: item.get("priority", 999)):
        relative_root = Path(source.get("image_root", safe_slug(source["source_id"])))
        source_dir = dataset_root / relative_root.name
        write_source_files(source_dir, source)

        entry = {
            "source_id": source["source_id"],
            "dataset_dir": str(source_dir),
            "acquisition_mode": source.get("acquisition_mode"),
            "downloaded": False,
            "annotations_downloaded": False,
        }

        if source["source_id"] in download_ids:
            url = source.get("official_download_url")
            if not url or source.get("acquisition_mode") != "direct_download":
                entry["downloaded"] = False
                entry["note"] = "No direct download available; see README.txt in the source folder."
            else:
                result = download_named_asset(
                    url=url,
                    dest_root=downloads_root / source["source_id"],
                    label="archive",
                    extract_archives=extract_archives,
                )
                entry["downloaded"] = True
                entry.update(result)

        if source["source_id"] in annotation_ids:
            annotations_url = source.get("annotations_download_url")
            if not annotations_url:
                entry["annotations_note"] = "No separate annotations download URL configured."
            else:
                result = download_named_asset(
                    url=annotations_url,
                    dest_root=downloads_root / source["source_id"],
                    label="annotations",
                    extract_archives=extract_archives,
                )
                entry["annotations_downloaded"] = True
                entry["annotations"] = result

        catalog["sources"].append(entry)

    (dataset_root / "_catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"dataset_root: {dataset_root}")
    print(f"catalog: {dataset_root / '_catalog.json'}")
    print(f"sources_bootstrapped: {len(catalog['sources'])}")

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap AEGIS disaster vision sources")
    parser.add_argument(
        "--dataset-root",
        default=str(detect_default_dataset_root()),
        help="Where to stage external datasets. Use a large drive such as D:/aegis-datasets on Windows.",
    )
    parser.add_argument(
        "--download",
        nargs="*",
        default=[],
        help="Source IDs to download directly when official direct links exist (example: crisismmd).",
    )
    parser.add_argument(
        "--download-annotations",
        nargs="*",
        default=[],
        help="Source IDs whose annotation packages should be downloaded separately when configured.",
    )
    parser.add_argument(
        "--extract",
        action="store_true",
        help="Extract downloaded zip/tar.gz archives into each source folder under _raw.",
    )
    return parser.parse_args()

def main() -> None:
    args = parse_args()
    bootstrap_sources(
        dataset_root=Path(args.dataset_root),
        download_ids=set(args.download),
        annotation_ids=set(args.download_annotations),
        extract_archives=args.extract,
    )

if __name__ == "__main__":
    main()
