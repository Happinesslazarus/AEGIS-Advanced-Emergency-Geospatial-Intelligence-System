"""
Module: cleanup_models.py

Cleanup_models AI engine module.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Ensure ai-engine root is on sys.path
_AI_ROOT = Path(__file__).resolve().parent.parent
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

from app.core.model_registry import ModelRegistry

async def run(args: argparse.Namespace) -> None:
    registry = ModelRegistry(str(_AI_ROOT / "model_registry"))
    await registry.load_all_models()

    print(f"\nRegistry: {registry.count_models()} models loaded")

    if args.list:
        if args.model and args.region:
            versions = registry.list_versions(args.model, args.region)
            print(f"\nVersions for {args.model}/{args.region}:")
            for v in versions:
                current = " [CURRENT]" if v["is_current"] else ""
                promo = f" ({v['promotion_status']})" if v["promotion_status"] != "none" else ""
                auc = v["performance_metrics"].get("roc_auc", "N/A")
                auc_str = f" AUC={auc:.4f}" if isinstance(auc, float) else ""
                print(f"  {v['version']}{current}{promo}{auc_str}")
        else:
            models = registry.list_models()
            print(f"\nAll models:")
            for m in models:
                promo = f" ({m['promotion_status']})" if m.get("promotion_status") else ""
                print(f"  {m['hazard_type']}/{m['region_id']} v{m['version']}{promo}")
        return

    if args.validate:
        if not args.model or not args.region:
            print("ERROR: --validate requires --model and --region")
            sys.exit(1)
        versions = registry.list_versions(args.model, args.region)
        for v in versions:
            result = registry.validate_model_integrity(args.model, args.region, v["version"])
            status = "OK" if result["valid"] else f"FAIL: {result['issues']}"
            print(f"  {v['version']}: {status}")
        return

    if args.promote:
        if not args.model or not args.region:
            print("ERROR: --promote requires --model and --region")
            sys.exit(1)
        result = registry.promote_model(args.model, args.region, args.promote)
        print(json.dumps(result, indent=2))
        return

    if args.demote:
        if not args.model or not args.region:
            print("ERROR: --demote requires --model and --region")
            sys.exit(1)
        result = registry.demote_model(args.model, args.region)
        print(json.dumps(result, indent=2))
        return

    # Cleanup mode
    if args.all:
        result = registry.cleanup_all_hazards(keep=args.keep, dry_run=args.dry_run)
        total_removed = sum(len(r.get("removed", [])) for r in result.values())
        print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Cleanup results:")
        for model_type, r in result.items():
            removed = r.get("removed", [])
            if removed:
                print(f"  {model_type}: removed {len(removed)} version(s)")
                for rm in removed:
                    print(f"    - {rm['key']} ({rm['action']})")
            else:
                print(f"  {model_type}: {r.get('message', 'no action')}")
        print(f"\nTotal removed: {total_removed}")
    elif args.model and args.region:
        result = registry.cleanup_old_versions(
            args.model, args.region, keep=args.keep, dry_run=args.dry_run
        )
        print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Cleanup {args.model}/{args.region}:")
        print(json.dumps(result, indent=2))
    else:
        print("Specify --all or --model + --region for cleanup.")
        print("Use --list to see all models, --dry-run to preview.")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="AEGIS Model Cleanup CLI")
    parser.add_argument("--model", help="Hazard type (e.g. flood, drought)")
    parser.add_argument("--region", default="uk-default", help="Region ID")
    parser.add_argument("--keep", type=int, default=3, help="Versions to keep (default: 3)")
    parser.add_argument("--all", action="store_true", help="Cleanup all hazard types")
    parser.add_argument("--dry-run", action="store_true", help="Preview without deleting")
    parser.add_argument("--list", action="store_true", help="List models/versions")
    parser.add_argument("--validate", action="store_true", help="Validate model integrity")
    parser.add_argument("--promote", metavar="VERSION", help="Promote a specific version")
    parser.add_argument("--demote", action="store_true", help="Remove manual promotion override")
    args = parser.parse_args()
    asyncio.run(run(args))

if __name__ == "__main__":
    main()
