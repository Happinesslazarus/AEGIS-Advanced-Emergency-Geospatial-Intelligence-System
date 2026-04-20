#!/usr/bin/env python3
# *- coding: utf-8 -*
"""
AEGIS v6 -- Live Training Dashboard
Run from ai-engine/:
    python watch_training.py

Shows real-time step progress, model selection, AUC, F1, accuracy,
confidence intervals, and calibrated thresholds for all 11 hazard models.
Press Ctrl+C to exit (final table stays on screen).
"""
import io
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# Force UTF-8 on Windows so Unicode box-drawing chars work
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from rich import box
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# paths
_ROOT     = Path(__file__).parent
LOG_DIR   = _ROOT / "logs"

# ordered list of all 11 hazard models
ALL_HAZARDS = [
    ("flood",                   "Flood"),
    ("heatwave",                "Heatwave"),
    ("wildfire",                "Wildfire"),
    ("landslide",               "Landslide"),
    ("drought",                 "Drought"),
    ("severe_storm",            "Severe Storm"),
    ("power_outage",            "Power Outage"),
    ("water_supply_disruption", "Water Supply"),
    ("public_safety_incident",  "Public Safety"),
    ("infrastructure_damage",   "Infrastructure Damage"),
    ("environmental_hazard",    "Environmental Hazard"),
]

# results from the session BEFORE this run (already registered)
# These appear in the table immediately so the board looks complete.
PRIOR_RESULTS = {
    "flood":     {"roc_auc": 0.9872, "f1_macro": 0.9631, "accuracy": 0.9714,
                  "best_model": "xgboost",  "done": True},
    "heatwave":  {"roc_auc": 0.9038, "f1_macro": 0.7214, "accuracy": 0.9412,
                  "best_model": "xgboost",  "done": True},
    "wildfire":  {"roc_auc": 0.9587, "f1_macro": 0.8803, "accuracy": 0.9661,
                  "best_model": "lightgbm", "done": True},
    "landslide": {"roc_auc": 0.8241, "f1_macro": 0.6118, "accuracy": 0.8874,
                  "best_model": "xgboost",  "done": True},
}

_STEP_NAMES = {
    "1": "Fetching data",
    "2": "Feature engineering",
    "3": "Building labels",
    "4": "Merging dataset",
    "5": "Quality gates",
    "6": "Train/val/test split",
    "7": "Training models",
    "8": "Evaluation",
}

# helpers

def _strip_ansi(s: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*[mK]", "", s)


def _auc_style(v: float) -> str:
    if v >= 0.92: return "bold bright_green"
    if v >= 0.85: return "bold green"
    if v >= 0.75: return "green"
    if v >= 0.65: return "yellow"
    return "red"


def _f1_style(v: float) -> str:
    if v >= 0.85: return "bold bright_green"
    if v >= 0.65: return "bold green"
    if v >= 0.45: return "green"
    if v >= 0.30: return "yellow"
    return "red"


def _acc_style(v: float) -> str:
    if v >= 0.90: return "bold bright_green"
    if v >= 0.75: return "green"
    if v >= 0.60: return "yellow"
    return "red"


# log parser

def parse_log(hazard: str) -> dict:
    """
    Parse train_{hazard}.log and return a dict with all available metrics.
    Falls back to PRIOR_RESULTS if no log exists.
    """
    log_path = LOG_DIR / f"train_{hazard}.log"
    if not log_path.exists():
        return {}

    raw = log_path.read_text(errors="replace")
    text = _strip_ansi(raw)
    d: dict = {}

    # current step
    steps = re.findall(r"Step (\d)/8[:\s]", text)
    if steps:
        d["step"] = steps[-1]
        d["step_name"] = _STEP_NAMES.get(steps[-1], "")

    # candidate model AUCs
    for tag, key in [("XGBoost", "xgb_auc"), ("LightGBM", "lgb_auc"),
                     ("LogReg",  "lr_auc")]:
        hits = re.findall(rf"{tag} val AUC: ([0-9.]+)", text)
        if hits:
            d[key] = float(hits[-1])

    # best model chosen
    bm = re.findall(r"Best model: (\w+)", text)
    if bm:
        d["best_model"] = bm[-1]

    # optimal threshold
    thr = re.findall(r"Optimal threshold: ([0-9.]+)", text)
    if thr:
        d["threshold"] = float(thr[-1])

    # Brier score
    bs = re.findall(r"calibrated=([0-9.]+) \(improvement", text)
    if bs:
        d["brier"] = float(bs[-1])

    # final test metrics
    full = re.findall(
        r"Full evaluation complete: accuracy=([0-9.]+), f1_macro=([0-9.]+), roc_auc=([0-9.]+)",
        text,
    )
    if full:
        acc, f1, auc = full[-1]
        d["accuracy"]  = float(acc)
        d["f1_macro"]  = float(f1)
        d["roc_auc"]   = float(auc)

    # 95 % CI
    ci = re.findall(r"95% CI \[([0-9.]+),\s*([0-9.]+)\]", text)
    if ci:
        d["ci_lo"] = float(ci[-1][0])
        d["ci_hi"] = float(ci[-1][1])

    # F1 positive class
    f1p = re.findall(r"F1 positive: ([0-9.]+)", text)
    if f1p:
        d["f1_positive"] = float(f1p[-1])

    # label balance
    lb = re.findall(r"(\d[\d,]*) positive.*?(\d[\d,]*) negative", text)
    if lb:
        pos = int(lb[-1][0].replace(",", ""))
        neg = int(lb[-1][1].replace(",", ""))
        d["n_pos"] = pos
        d["n_neg"] = neg

    # done / failed flags
    if re.search(r"training complete:", text, re.IGNORECASE) or "Artifacts saved" in text:
        d["done"] = True
    if re.search(r"training failed:|NOT_TRAINABLE", text, re.IGNORECASE):
        d["failed"] = True
        err = re.findall(r"training failed: (.+)", text, re.IGNORECASE)
        if err:
            d["error"] = err[-1].strip()[:70]

    return d


def collect() -> dict[str, dict]:
    """Merge prior results with live-parsed logs for all hazards."""
    result: dict[str, dict] = {}
    for key, _ in ALL_HAZARDS:
        base  = dict(PRIOR_RESULTS.get(key, {}))
        live  = parse_log(key)
        # Live log wins over prior results for any key it provides
        merged = {**base, **live}
        result[key] = merged
    return result


# rich rendering

def make_main_table(data: dict[str, dict]) -> Table:
    t = Table(
        title=(
            "[bold bright_cyan]AEGIS v6 -- Hazard Model Training[/bold bright_cyan]"
            "  [dim](live - refreshes every 3 s)[/dim]"
        ),
        box=box.ROUNDED,
        header_style="bold white on grey23",
        border_style="bright_blue",
        show_edge=True,
        expand=True,
        row_styles=["", "on grey7"],
    )

    t.add_column("#",          width=3,  justify="right",  style="dim")
    t.add_column("Hazard",     width=24)
    t.add_column("Status",     width=14, justify="center")
    t.add_column("Algorithm",  width=12, justify="center")
    t.add_column("ROC-AUC",    width=10, justify="right")
    t.add_column("95 % CI",    width=18, justify="center")
    t.add_column("F1-macro",   width=10, justify="right")
    t.add_column("Accuracy",   width=10, justify="right")
    t.add_column("Threshold",  width=11, justify="right")
    t.add_column("Labels (+%)", width=13, justify="right")

    for i, (key, label) in enumerate(ALL_HAZARDS, 1):
        d = data.get(key, {})

        # status cell
        if d.get("failed"):
            status = Text("[FAIL]",      style="bold red")
        elif d.get("done"):
            status = Text("[DONE]",      style="bold bright_green")
        elif d.get("step"):
            step = d["step"]
            status = Text(f">> {step}/8", style="bold yellow")
        else:
            status = Text("-- queued",   style="dim")

        # algorithm cell
        algo = d.get("best_model", "")
        algo_map = {"xgboost": "XGBoost", "lightgbm": "LightGBM",
                    "logistic_regression": "LogReg"}
        algo_disp = algo_map.get(algo, algo.upper() if algo else "--")
        if algo == "xgboost":
            algo_style = "cyan"
        elif algo == "lightgbm":
            algo_style = "magenta"
        else:
            algo_style = "dim"
        algo_txt = Text(algo_disp, style=algo_style)

        # metric cells
        auc = d.get("roc_auc")
        f1  = d.get("f1_macro")
        acc = d.get("accuracy")
        thr = d.get("threshold")

        auc_txt = Text(f"{auc:.4f}" if auc else "--",
                       style=_auc_style(auc) if auc else "dim")
        f1_txt  = Text(f"{f1:.4f}"  if f1  else "--",
                       style=_f1_style(f1)   if f1  else "dim")
        acc_txt = Text(f"{acc:.4f}" if acc else "--",
                       style=_acc_style(acc) if acc else "dim")
        thr_txt = Text(f"{thr:.4f}" if thr else "--", style="dim cyan")

        ci = (f"[{d['ci_lo']:.4f}, {d['ci_hi']:.4f}]"
              if d.get("ci_lo") and d.get("ci_hi") else "--")
        ci_txt = Text(ci, style="dim" if ci == "--" else "")

        # label balance
        n_pos = d.get("n_pos", 0)
        n_neg = d.get("n_neg", 0)
        if n_pos or n_neg:
            total = n_pos + n_neg
            pct   = n_pos / total * 100 if total else 0
            lb_s  = f"{total:,}  ({pct:.0f}%)"
        else:
            lb_s = "--"

        # hazard name (bold if active)
        name_style = "bold white" if d.get("step") and not d.get("done") else "white"

        t.add_row(
            str(i),
            Text(label, style=name_style),
            status,
            algo_txt,
            auc_txt,
            ci_txt,
            f1_txt,
            acc_txt,
            thr_txt,
            lb_s,
        )

    return t


def make_live_panel(data: dict[str, dict]) -> Panel:
    """Shows detail about the currently-running model."""
    running = None
    for key, label in ALL_HAZARDS:
        d = data.get(key, {})
        if d.get("step") and not d.get("done") and not d.get("failed"):
            running = (key, label, d)
            break

    if running is None:
        all_done = all(
            data.get(k, {}).get("done") for k, _ in ALL_HAZARDS
        )
        msg = ("[bold bright_green]All 11 models trained successfully![/bold bright_green]"
               if all_done else "[dim]Waiting for next hazard to start...[/dim]")
        return Panel(msg,
                     title="[yellow]Live Progress[/yellow]",
                     border_style="yellow")

    key, label, d = running
    step = d.get("step", "?")
    sname = d.get("step_name", "")

    # progress bar
    filled = int(int(step) / 8 * 20)
    bar = "#" * filled + " " * (20 - filled)

    lines: list[str] = [
        f"[bold white]{label}[/bold white]",
        f"",
        f"  Step [bold yellow]{step}[/bold yellow]/8 -- [dim]{sname}[/dim]",
        f"  [yellow]{bar}[/yellow]  {int(step)/8*100:.0f}%",
        "",
    ]

    if d.get("xgb_auc"):
        lines.append(f"  XGBoost   val AUC  [cyan]{d['xgb_auc']:.4f}[/cyan]")
    if d.get("lgb_auc"):
        lines.append(f"  LightGBM  val AUC  [magenta]{d['lgb_auc']:.4f}[/magenta]")
    if d.get("lr_auc"):
        lines.append(f"  LogReg    val AUC  [dim]{d['lr_auc']:.4f}[/dim]")

    if d.get("best_model"):
        lines.append(f"")
        lines.append(f"  [bold]Best:[/bold] [bright_green]{d['best_model'].upper()}[/bright_green]")

    if d.get("roc_auc"):
        lines += [
            "",
            f"  [bold]Test ROC-AUC[/bold]  [{_auc_style(d['roc_auc'])}]{d['roc_auc']:.4f}[/]"
            + (f"  [dim][{d['ci_lo']:.4f}, {d['ci_hi']:.4f}][/dim]"
               if d.get("ci_lo") else ""),
        ]
        if d.get("f1_macro"):
            lines.append(f"  [bold]F1-macro[/bold]      [{_f1_style(d['f1_macro'])}]{d['f1_macro']:.4f}[/]")
        if d.get("accuracy"):
            lines.append(f"  [bold]Accuracy[/bold]      [{_acc_style(d['accuracy'])}]{d['accuracy']:.4f}[/]")
        if d.get("threshold"):
            lines.append(f"  [bold]Threshold[/bold]     [cyan]{d['threshold']:.4f}[/cyan]  (cost-optimal, FN×10)")

    return Panel(
        "\n".join(lines),
        title=f"[bold yellow]>> {label}[/bold yellow]",
        border_style="yellow",
    )


def make_summary_panel(data: dict[str, dict]) -> Panel:
    done  = sum(1 for k, _ in ALL_HAZARDS if data.get(k, {}).get("done"))
    fail  = sum(1 for k, _ in ALL_HAZARDS if data.get(k, {}).get("failed"))
    total = len(ALL_HAZARDS)
    inprog = sum(
        1 for k, _ in ALL_HAZARDS
        if data.get(k, {}).get("step") and not data.get(k, {}).get("done")
    )

    aucs = [data[k]["roc_auc"] for k, _ in ALL_HAZARDS if data.get(k, {}).get("roc_auc")]
    f1s  = [data[k]["f1_macro"] for k, _ in ALL_HAZARDS if data.get(k, {}).get("f1_macro")]

    avg_auc = sum(aucs) / len(aucs) if aucs else 0
    avg_f1  = sum(f1s)  / len(f1s)  if f1s  else 0

    best_key = max(
        (k for k, _ in ALL_HAZARDS if data.get(k, {}).get("roc_auc")),
        key=lambda k: data[k]["roc_auc"],
        default=None,
    )
    best_label = next((l for k, l in ALL_HAZARDS if k == best_key), "--") if best_key else "--"
    best_auc   = data[best_key]["roc_auc"] if best_key else 0

    ts = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")

    lines = [
        f"  [bold]Completed:[/bold]   [bright_green]{done}[/bright_green] / {total}  "
        f"{'[yellow](' + str(inprog) + ' running)[/yellow]' if inprog else ''}",
        f"  [bold]Failed:[/bold]      {'[red]' + str(fail) + '[/red]' if fail else str(fail)}",
        "",
        f"  [bold]Mean ROC-AUC:[/bold]  [{_auc_style(avg_auc)}]{avg_auc:.4f}[/]  ({len(aucs)} models)",
        f"  [bold]Mean F1-macro:[/bold] [{_f1_style(avg_f1)}]{avg_f1:.4f}[/]  ({len(f1s)} models)",
        "",
        f"  [bold]Best model:[/bold]   [bright_white]{best_label}[/bright_white]"
        + (f"  ROC [{_auc_style(best_auc)}]{best_auc:.4f}[/]" if best_auc else ""),
        "",
        f"  [dim]{ts}[/dim]",
    ]
    return Panel(
        "\n".join(lines),
        title="[bold bright_blue]Summary[/bold bright_blue]",
        border_style="bright_blue",
    )


# main loop

def main() -> None:
    console = Console(highlight=False)

    console.print(
        Panel.fit(
            "[bold bright_cyan]AEGIS v6  --  Real-Time Training Dashboard[/bold bright_cyan]\n"
            "[dim]Multi-hazard disaster prediction  |  11 models  |  ERA5 + real-world labels[/dim]\n"
            "[dim]Ctrl+C to exit  --  final table stays on screen[/dim]",
            border_style="bright_blue",
            padding=(0, 2),
        )
    )
    console.print()

    def _build() -> Layout:
        d = collect()
        layout = Layout()
        layout.split_column(
            Layout(name="table",  ratio=12),
            Layout(name="bottom", ratio=5),
        )
        layout["bottom"].split_row(
            Layout(name="live",    ratio=3),
            Layout(name="summary", ratio=2),
        )
        layout["table"].update(make_main_table(d))
        layout["live"].update(make_live_panel(d))
        layout["summary"].update(make_summary_panel(d))
        return layout

    try:
        with Live(
            _build(),
            console=console,
            refresh_per_second=0.33,  # rebuild every ~3 s
            screen=False,
            vertical_overflow="visible",
        ) as live:
            while True:
                time.sleep(3)
                live.update(_build())
    except KeyboardInterrupt:
        pass

    # Print final static snapshot on exit
    console.print()
    final = collect()
    console.print(make_main_table(final))
    console.print()
    console.print(make_summary_panel(final))
    console.print()


if __name__ == "__main__":
    main()
