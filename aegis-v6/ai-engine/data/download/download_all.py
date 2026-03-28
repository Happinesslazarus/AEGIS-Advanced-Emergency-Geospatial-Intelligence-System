from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import UTC, datetime
import json
from pathlib import Path
from time import perf_counter

try:
    from tqdm import tqdm
except ImportError:
    class _NoOpTqdm:
        def __init__(self, total: int, desc: str = "") -> None:
            self.total = total
            self.desc = desc

        def __enter__(self) -> "_NoOpTqdm":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def update(self, n: int = 1) -> None:
            return None

    def tqdm(*, total: int, desc: str = "") -> _NoOpTqdm:
        return _NoOpTqdm(total=total, desc=desc)

from registry.region_registry import get_enabled_regions, get_region, get_all_regions
from data.providers.base_provider import DownloadResult, ProviderDiscovery, write_provider_output

def _register_provider_modules() -> None:
    import importlib

    modules = [
        "data.providers.sepa_provider",
        "data.providers.environment_agency_provider",
        "data.providers.era5_provider",
        "data.providers.nrfa_provider",
        "data.providers.enso_provider",
    ]
    for module_name in modules:
        try:
            importlib.import_module(module_name)
        except Exception as exc:
            print(f"Warning: could not load provider module {module_name}: {exc}")

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AEGIS universal download orchestrator")
    parser.add_argument("--region", default="scotland", help="Region id or 'all'")
    parser.add_argument("--provider", default=None, help="Single provider name")
    parser.add_argument("--start", default="2000-01-01")
    parser.add_argument("--end", default=datetime.now(UTC).strftime("%Y-%m-%d"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()

def _regions_from_arg(region_arg: str) -> list[str]:
    if region_arg == "all":
        return [r.region_id for r in get_enabled_regions()]
    get_region(region_arg)
    return [region_arg]

def _run_provider(provider_name: str, region_id: str, start: str, end: str, force: bool) -> DownloadResult:
    out_dir = Path("data/raw") / region_id / provider_name
    out_dir.mkdir(parents=True, exist_ok=True)

    out_file = out_dir / f"{start}_{end}.parquet"
    if out_file.exists() and not force:
        elapsed = 0.0
        return DownloadResult(
            provider=provider_name,
            region_id=region_id,
            rows=0,
            is_synthetic=False,
            file_path=str(out_file),
            sha256="SKIPPED",
            start=start,
            end=end,
            elapsed_s=elapsed,
            error="skipped_exists",
        )

    t0 = perf_counter()
    provider = ProviderDiscovery.instantiate_by_name(provider_name)
    try:
        df, _synthetic_flag = provider.download_with_fallback(region_id, start, end)
    except Exception as exc:
        return DownloadResult(
            provider=provider_name,
            region_id=region_id,
            rows=0,
            is_synthetic=False,
            file_path=str(out_file),
            sha256="FAILED",
            start=start,
            end=end,
            elapsed_s=perf_counter() - t0,
            error=str(exc),
        )
    digest = write_provider_output(df, out_file)

    return DownloadResult(
        provider=provider_name,
        region_id=region_id,
        rows=len(df),
        is_synthetic=False,
        file_path=str(out_file),
        sha256=digest,
        start=start,
        end=end,
        elapsed_s=perf_counter() - t0,
        error=None,
    )

def main() -> None:
    args = _parse_args()
    _register_provider_modules()
    regions = _regions_from_arg(args.region)
    all_provider_names = sorted(p.name for p in ProviderDiscovery.instantiate_all())

    provider_names = [args.provider] if args.provider else all_provider_names

    if args.dry_run:
        print(json.dumps({"regions": regions, "providers": provider_names, "start": args.start, "end": args.end}, indent=2))
        return

    tasks: list[tuple[str, str]] = []
    for region_id in regions:
        for provider_name in provider_names:
            tasks.append((provider_name, region_id))

    results: list[DownloadResult] = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_run_provider, provider_name, region_id, args.start, args.end, args.force): (provider_name, region_id)
            for provider_name, region_id in tasks
        }

        with tqdm(total=len(futures), desc="Downloading providers") as progress:
            for future in as_completed(futures):
                results.append(future.result())
                progress.update(1)

    manifest_path = Path("data/raw/download_manifest.json")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump([asdict(result) for result in results], f, indent=2)

    print("\nProvider | Region | Rows | Synthetic | SHA[:8] | Elapsed | Status")
    print("-" * 90)
    for result in sorted(results, key=lambda r: (r.region_id, r.provider)):
        status = "OK" if result.error is None else result.error
        print(
            f"{result.provider:24} | {result.region_id:10} | {result.rows:6d} | "
            f"{str(result.is_synthetic):9} | {result.sha256[:8]:8} | {result.elapsed_s:7.2f}s | {status}"
        )

if __name__ == "__main__":
    main()
