#!/usr/bin/env python3
"""
watch_training.py — Live training progress monitor for AEGIS.

Usage:
    python watch_training.py                         # watches latest log file
    python watch_training.py --log path/to/file.log  # watches specific file
    python watch_training.py --summary               # one-shot status table

Press Ctrl+C to exit.
"""

import argparse
import os
import re
import sys
import time
from pathlib import Path

# ANSI colours
_R  = "\033[31m"   # red
_G  = "\033[32m"   # green
_Y  = "\033[33m"   # yellow
_B  = "\033[34m"   # blue
_C  = "\033[36m"   # cyan
_W  = "\033[37m"   # white
_DIM = "\033[2m"
_BOLD = "\033[1m"
_RST = "\033[0m"

HAZARDS = [
    "flood", "drought", "heatwave", "severe_storm", "wildfire",
    "landslide", "power_outage", "water_supply_disruption",
    "infrastructure_damage", "public_safety_incident", "environmental_hazard",
]

STEPS = [
    "Fetching raw data",
    "Engineering features",
    "Constructing labels",
    "Merging features and labels",
    "Checking data quality gates",
    "Chronological train/val/test split",
    "Training candidate models",
    "Evaluating",
]

def _strip_ansi(s: str) -> str:
    return re.sub(r'\x1b\[[0-9;]*m', '', s)


def parse_log(lines: list[str]) -> dict:
    """Parse log lines into a structured state dict."""
    state = {h: {"status": "pending", "step": 0, "version": None, "error": None}
             for h in HAZARDS}
    current = None

    for raw in lines:
        line = _strip_ansi(raw)

        # Detect which hazard is being trained
        m = re.search(r'TRAINING: (\w+) /', line)
        if m:
            current = m.group(1).lower()
            if current in state:
                state[current]["status"] = "running"
                state[current]["step"] = 0
            continue

        if current not in state:
            continue

        # Step progress
        m = re.search(r'Step (\d+)/8:', line)
        if m:
            state[current]["step"] = int(m.group(1))

        # Success
        m = re.search(r'SUCCESS.*version=(v[\d.]+)', line)
        if m:
            state[current]["status"] = "success"
            state[current]["version"] = m.group(1)
            state[current]["step"] = 8

        # Failed (warned)
        if re.search(r'WARNING.*' + re.escape(current) + r': failed', line, re.IGNORECASE):
            err = re.sub(r'^.*failed — ', '', line).strip()[:80]
            state[current]["status"] = "failed"
            state[current]["error"] = err

        # Exception
        if re.search(r'ERROR.*' + re.escape(current) + r': EXCEPTION', line, re.IGNORECASE):
            err = re.sub(r'^.*EXCEPTION — ', '', line).strip()[:80]
            state[current]["status"] = "failed"
            state[current]["error"] = err

        # NOT_TRAINABLE
        if "NOT_TRAINABLE" in line:
            err = re.search(r'NOT_TRAINABLE.*?—\s*(.+)', line)
            if err:
                state[current]["error"] = err.group(1).strip()[:80]

    return state


def render_table(state: dict, elapsed: float = 0) -> str:
    bars = {
        "pending": f"{_DIM}  [ PENDING ]  {_RST}",
        "running": f"{_C}  [ RUNNING ] {_RST}",
        "success": f"{_G}  [  SUCCESS ] {_RST}",
        "failed":  f"{_R}  [  FAILED  ] {_RST}",
    }
    step_bar_len = 8

    lines = []
    lines.append(f"\n{_BOLD}{'='*72}{_RST}")
    lines.append(f"{_BOLD}  AEGIS Training Monitor{_RST}   elapsed: {elapsed:.0f}s")
    lines.append(f"{_BOLD}{'='*72}{_RST}")
    lines.append(f"  {'Hazard':<30} {'Status':<18} {'Step':<14} {'Detail'}")
    lines.append(f"  {'-'*68}")

    done = 0
    for h in HAZARDS:
        s = state[h]
        st = s["status"]
        status_str = bars.get(st, st)
        step = s["step"]

        # Progress bar for running hazard
        if st == "running":
            filled = int((step / 8) * step_bar_len)
            bar = f"[{'█'*filled}{'░'*(step_bar_len-filled)}] {step}/8"
            step_str = f"{_C}{bar}{_RST}"
        elif st == "success":
            step_str = f"{_G}{'█'*step_bar_len} 8/8{_RST}"
            done += 1
        elif st == "failed":
            filled = int((step / 8) * step_bar_len)
            step_str = f"{_R}{'█'*filled}{'░'*(step_bar_len-filled)} {step}/8{_RST}"
        else:
            step_str = f"{_DIM}{'░'*step_bar_len} 0/8{_RST}"

        detail = ""
        if s["version"]:
            detail = f"{_G}{s['version']}{_RST}"
        elif s["error"]:
            detail = f"{_R}{s['error'][:45]}...{_RST}" if len(s["error"]) > 45 else f"{_R}{s['error']}{_RST}"

        lines.append(f"  {h:<30} {status_str} {step_str}  {detail}")

    total = len(HAZARDS)
    running = sum(1 for s in state.values() if s["status"] == "running")
    failed  = sum(1 for s in state.values() if s["status"] == "failed")

    lines.append(f"\n  {_BOLD}Progress: {done}/{total} complete | {running} running | {failed} failed{_RST}")
    lines.append(f"{_BOLD}{'='*72}{_RST}\n")
    return "\n".join(lines)


def find_latest_log() -> Path | None:
    """Find the most recently modified training log."""
    ai_root = Path(__file__).resolve().parent
    candidates = []
    for p in (ai_root / "logs").glob("*.log"):
        candidates.append(p)
    # Also check reports dir
    for p in (ai_root / "reports").glob("*.log"):
        candidates.append(p)
    if candidates:
        return sorted(candidates, key=lambda p: p.stat().st_mtime)[-1]
    return None


def watch(log_path: Path | None = None, summary_only: bool = False) -> None:
    started = time.time()
    last_size = -1

    if log_path is None:
        log_path = find_latest_log()
        if log_path is None:
            print("No log file found. Run training first:")
            print("  python -m app.training.train_all --fast")
            sys.exit(1)

    print(f"Watching: {log_path}")

    while True:
        try:
            size = log_path.stat().st_size if log_path.exists() else 0
            if size != last_size or summary_only:
                last_size = size
                try:
                    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
                except Exception:
                    lines = []

                state = parse_log(lines)
                elapsed = time.time() - started

                if not summary_only:
                    # Clear screen and redraw
                    os.system("cls" if os.name == "nt" else "clear")

                print(render_table(state, elapsed))

                if summary_only:
                    return

                all_done = all(s["status"] in ("success", "failed")
                               for s in state.values()
                               if s["status"] != "pending")
                active = [h for h, s in state.items() if s["status"] == "running"]
                if not active and any(s["status"] == "success" for s in state.values()):
                    print("Training complete.")
                    return

            time.sleep(3)

        except KeyboardInterrupt:
            print("\nMonitor stopped.")
            return


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS Training Progress Monitor")
    parser.add_argument("--log", type=Path, help="Path to log file to watch")
    parser.add_argument("--summary", action="store_true", help="Print one-shot summary and exit")
    args = parser.parse_args()
    watch(log_path=args.log, summary_only=args.summary)
