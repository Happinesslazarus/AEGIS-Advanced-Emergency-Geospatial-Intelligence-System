#!/usr/bin/env python3
"""
Download_benchmark_images AI engine module.
"""

import json
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

BENCHMARK_FILE = Path(__file__).parent.parent / "data" / "vision_benchmark.json"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "server" / "uploads" / "chat" / "benchmark"

HEADERS = {
    "User-Agent": "AEGISBenchmarkDownloader/1.0 (disaster-response-research; contact@aegis-project.org)"
}

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds between retries
DELAY_BETWEEN = 2  # seconds between downloads

def download_image(url: str, dest: Path, retries: int = MAX_RETRIES) -> bool:
    """Download a single image with retries."""
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers=HEADERS)
            resp = urlopen(req, timeout=30)
            content_type = resp.headers.get("Content-Type", "")
            data = resp.read()

            # Verify it's actually an image
            if b"<!DO" in data[:10] or b"<html" in data[:20]:
                print(f"    ! Got HTML instead of image (attempt {attempt}/{retries})")
                if attempt < retries:
                    time.sleep(RETRY_DELAY * attempt)
                    continue
                return False

            if len(data) < 1000:
                print(f"    ! Suspiciously small ({len(data)} bytes), attempt {attempt}/{retries}")
                if attempt < retries:
                    time.sleep(RETRY_DELAY * attempt)
                    continue
                return False

            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            print(f"    [OK] {len(data):,} bytes")
            return True

        except HTTPError as e:
            print(f"    ! HTTP {e.code} (attempt {attempt}/{retries})")
            if attempt < retries:
                time.sleep(RETRY_DELAY * attempt)
        except (URLError, TimeoutError, Exception) as e:
            print(f"    ! {str(e)[:60]} (attempt {attempt}/{retries})")
            if attempt < retries:
                time.sleep(RETRY_DELAY * attempt)

    return False

def main():
    if not BENCHMARK_FILE.exists():
        print(f"ERROR: {BENCHMARK_FILE} not found")
        sys.exit(1)

    with open(BENCHMARK_FILE) as f:
        data = json.load(f)

    benchmark = data["benchmark"]
    print(f"Downloading {len(benchmark)} benchmark images...")
    print(f"Output: {OUTPUT_DIR}\n")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    success = 0
    failed = []

    for i, item in enumerate(benchmark, 1):
        img_id = item["id"]
        url = item["url"]
        # Determine extension from URL
        ext = ".jpg"
        if ".png" in url.lower():
            ext = ".png"
        elif ".jpeg" in url.lower():
            ext = ".jpeg"

        dest = OUTPUT_DIR / f"{img_id}{ext}"

        if dest.exists() and dest.stat().st_size > 1000:
            print(f"[{i}/{len(benchmark)}] {img_id}: Already cached ({dest.stat().st_size:,} bytes)")
            success += 1
            continue

        print(f"[{i}/{len(benchmark)}] {img_id}: {item['description'][:50]}...")
        if download_image(url, dest):
            success += 1
            # Update the item with local path
            item["local_path"] = f"/uploads/chat/benchmark/{img_id}{ext}"
        else:
            failed.append(img_id)
            print(f"    [FAIL] FAILED after {MAX_RETRIES} attempts")

        time.sleep(DELAY_BETWEEN)

    # Update local_path for previously cached items too
    for item in benchmark:
        img_id = item["id"]
        ext = ".jpg"
        if ".png" in item["url"].lower():
            ext = ".png"
        elif ".jpeg" in item["url"].lower():
            ext = ".jpeg"
        dest = OUTPUT_DIR / f"{img_id}{ext}"
        if dest.exists() and dest.stat().st_size > 1000:
            item["local_path"] = f"/uploads/chat/benchmark/{img_id}{ext}"

    # Save updated benchmark
    with open(BENCHMARK_FILE, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\n{'='*50}")
    print(f"  Downloaded: {success}/{len(benchmark)}")
    if failed:
        print(f"  Failed: {', '.join(failed)}")
    print(f"  Benchmark JSON updated with local_path fields")
    print(f"{'='*50}")

    if failed:
        print(f"\n! {len(failed)} images failed. You may need to find alternative URLs.")
        sys.exit(1)

if __name__ == "__main__":
    main()
