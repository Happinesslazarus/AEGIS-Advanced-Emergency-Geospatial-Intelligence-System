"""
Module: profile_local_stack.py

Profile_local_stack AI engine module.
"""

from __future__ import annotations

import ctypes
import json
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent
SERVER_ENV = WORKSPACE_ROOT / "server" / ".env"
REPORT_PATH = ROOT / "reports" / "local_stack_profile.json"

@dataclass
class LocalProfile:
    primary: str
    fast: str
    specialist: str
    ultrafast: str
    vision: str
    rationale: str

def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values

def get_total_ram_bytes() -> int | None:
    if os.name == "nt":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullTotalPhys)
        return None

    if hasattr(os, "sysconf") and "SC_PAGE_SIZE" in os.sysconf_names and "SC_PHYS_PAGES" in os.sysconf_names:
        return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"))

    return None

def bytes_to_gb(value: int | None) -> float | None:
    if value is None:
        return None
    return round(value / (1024 ** 3), 2)

def detect_gpu() -> dict[str, Any]:
    result = {
        "name": None,
        "vram_gb": None,
        "cuda_available": None,
        "source": None,
    }

    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            result["name"] = props.name
            result["vram_gb"] = round(props.total_memory / (1024 ** 3), 2)
            result["cuda_available"] = True
            result["source"] = "torch"
            return result

        result["cuda_available"] = False
        result["source"] = "torch"
    except Exception:
        pass

    try:
        completed = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=True,
        )
        first = completed.stdout.strip().splitlines()[0]
        name, memory = [part.strip() for part in first.split(",", 1)]
        result["name"] = name
        result["vram_gb"] = round(float(memory.split()[0]) / 1024, 2)
        result["source"] = "nvidia-smi"
        if result["cuda_available"] is None:
            result["cuda_available"] = True
    except Exception:
        pass

    return result

def list_ollama_models() -> list[str]:
    try:
        completed = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception:
        return []

    models: list[str] = []
    for line in completed.stdout.splitlines():
        stripped = line.strip()
        if not stripped or stripped.lower().startswith("name"):
            continue
        model = stripped.split()[0]
        if model not in models:
            models.append(model)
    return models

def get_disk_summary() -> list[dict[str, Any]]:
    roots = []
    if os.name == "nt":
        for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
            root = Path(f"{letter}:/")
            if root.exists():
                roots.append(root)
    else:
        roots.append(Path("/"))

    summary = []
    for root in roots:
        try:
            usage = shutil.disk_usage(root)
        except Exception:
            continue
        summary.append(
            {
                "path": str(root),
                "free_gb": round(usage.free / (1024 ** 3), 2),
                "total_gb": round(usage.total / (1024 ** 3), 2),
            }
        )
    return summary

def recommend_profile(vram_gb: float | None) -> LocalProfile:
    if vram_gb is not None and vram_gb >= 20:
        return LocalProfile(
            primary="qwen3:14b",
            fast="qwen3:8b",
            specialist="deepseek-r1:8b",
            ultrafast="qwen3:4b",
            vision="qwen2.5vl:7b",
            rationale="20GB+ VRAM can support a larger primary model while keeping a strong local vision model.",
        )

    if vram_gb is not None and vram_gb >= 10:
        return LocalProfile(
            primary="qwen3:8b",
            fast="qwen3:4b",
            specialist="deepseek-r1:8b",
            ultrafast="qwen3:1.7b",
            vision="qwen2.5vl:7b",
            rationale="10-12GB VRAM is ideal for an 8B text model and a separate 7B vision model.",
        )

    return LocalProfile(
        primary="qwen3:8b",
        fast="qwen3:4b",
        specialist="qwen3:8b",
        ultrafast="qwen3:1.7b",
        vision="qwen2.5vl:7b",
        rationale="8GB VRAM works best with an 8B main chat model, smaller fast tiers, and a separate vision model used only when needed.",
    )

def validate_profile(env_values: dict[str, str], installed_models: list[str], recommended: LocalProfile) -> dict[str, Any]:
    configured = {
        "primary": env_values.get("OLLAMA_PRIMARY_MODEL"),
        "fast": env_values.get("OLLAMA_FAST_MODEL"),
        "specialist": env_values.get("OLLAMA_SPECIALIST_MODEL"),
        "ultrafast": env_values.get("OLLAMA_ULTRAFAST_MODEL"),
        "vision": env_values.get("OLLAMA_VISION_MODEL"),
    }

    expected = asdict(recommended)
    expected.pop("rationale", None)

    matches = {key: configured.get(key) == expected[key] for key in expected}
    missing_models = sorted(
        {
            model
            for model in expected.values()
            if model and model not in installed_models
        }
    )

    issues = []
    for key, ok in matches.items():
        if not ok:
            issues.append(
                {
                    "type": "config_mismatch",
                    "slot": key,
                    "configured": configured.get(key),
                    "recommended": expected[key],
                }
            )

    for model in missing_models:
        issues.append(
            {
                "type": "model_missing",
                "model": model,
            }
        )

    return {
        "configured": configured,
        "recommended": expected,
        "matches": matches,
        "missing_models": missing_models,
        "issues": issues,
    }

def best_dataset_drive(disks: list[dict[str, Any]]) -> str | None:
    if not disks:
        return None
    best = max(disks, key=lambda item: item["free_gb"])
    return best["path"]

def build_report() -> dict[str, Any]:
    env_values = load_env(SERVER_ENV)
    gpu = detect_gpu()
    ram_bytes = get_total_ram_bytes()
    ram_gb = bytes_to_gb(ram_bytes)
    disks = get_disk_summary()
    installed_models = list_ollama_models()
    recommended = recommend_profile(gpu["vram_gb"])
    validation = validate_profile(env_values, installed_models, recommended)

    return {
        "machine": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "cpu_logical_cores": os.cpu_count(),
            "total_ram_gb": ram_gb,
            "gpu": gpu,
            "disks": disks,
            "best_dataset_drive": best_dataset_drive(disks),
        },
        "ollama": {
            "installed_models": installed_models,
            "installed_model_count": len(installed_models),
        },
        "profile_validation": validation,
        "recommendation": {
            "profile": asdict(recommended),
            "dataset_root_suggestion": (
                "D:/aegis-datasets"
                if best_dataset_drive(disks) == "D:\\"
                else None
            ),
            "notes": [
                "Keep vision separated from the main chat model on 8GB VRAM.",
                "Use local models for the majority path and reserve API usage for hard cases.",
                "Store large external datasets on the drive with the most free space instead of the repo drive.",
            ],
        },
    }

def main() -> None:
    report = build_report()
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("AEGIS local stack profile")
    print(f"report: {REPORT_PATH}")
    machine = report["machine"]
    gpu = machine["gpu"]
    print(f"ram_gb: {machine['total_ram_gb']}")
    print(f"gpu: {gpu['name']} ({gpu['vram_gb']} GB)")
    print(f"best_dataset_drive: {machine['best_dataset_drive']}")
    print(f"installed_ollama_models: {report['ollama']['installed_model_count']}")
    print(f"profile_issues: {len(report['profile_validation']['issues'])}")

if __name__ == "__main__":
    main()
