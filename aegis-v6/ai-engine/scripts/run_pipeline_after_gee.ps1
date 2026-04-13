#!/usr/bin/env pwsh
# Waits for GEE to complete all 48 chunks, then runs the full AI pipeline:
# 1. build_master_dataset.py
# 2. All 7 label builders
# 3. train_flood_v2.py, train_drought_v2.py, train_all_hazards_v2.py
# 4. compare_v1_v2.py, ablation_study.py, cross_region_test.py

$PYTHON = "e:\aegis-v6-fullstack\.venv\Scripts\python.exe"
$ROOT   = "e:\aegis-v6-fullstack\aegis-v6\ai-engine"
$LOG    = "$ROOT\logs\pipeline.log"
$GEE_DIR = "$ROOT\data\raw\gee"
$CHUNKS_TARGET = 48

Set-Location $ROOT
$env:WANDB_MODE = "offline"
$env:PYTHONUTF8 = "1"

function Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    Add-Content -Path $LOG -Value $line
}

function Run($script, $args_str = "") {
    Log "Running: $script $args_str"
    if ($args_str) {
        & $PYTHON $script $args_str.Split(" ") 2>&1 | Tee-Object -FilePath $LOG -Append
    } else {
        & $PYTHON $script 2>&1 | Tee-Object -FilePath $LOG -Append
    }
    if ($LASTEXITCODE -ne 0) {
        Log "ERROR: $script exited with code $LASTEXITCODE"
    } else {
        Log "DONE: $script"
    }
}

Log "=== AEGIS Pipeline Runner ==="
Log "Waiting for GEE to produce $CHUNKS_TARGET chunks..."

# ── Wait for GEE ──
while ($true) {
    $n = (Get-ChildItem $GEE_DIR -Filter "chunk_*.parquet" -ErrorAction SilentlyContinue).Count
    $geeRunning = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*gee_extractor*" }).Count -gt 0
    Log "  Chunks: $n / $CHUNKS_TARGET  (GEE running: $geeRunning)"

    if ($n -ge $CHUNKS_TARGET) {
        Log "All $CHUNKS_TARGET chunks present. Starting pipeline."
        break
    }
    if (-not $geeRunning -and $n -gt 0) {
        Log "GEE process stopped with $n chunks. Proceeding with available data."
        break
    }
    Start-Sleep -Seconds 120
}

# ── Step 1: Build master dataset ──
Log "=== Step 1: build_master_dataset.py ==="
Run "scripts/features/build_master_dataset.py"

# Check output exists
$masterPath = Join-Path $ROOT "data\processed\master_dataset.parquet"
if (-not (Test-Path $masterPath)) {
    Log "WARNING: master_dataset.parquet not found — label builders may fail"
}

# ── Step 2: Label builders ──
Log "=== Step 2: Label builders ==="
foreach ($lb in @(
    "scripts/labels/build_flood_labels.py",
    "scripts/labels/build_drought_labels.py",
    "scripts/labels/build_heatwave_labels.py",
    "scripts/labels/build_storm_labels.py",
    "scripts/labels/build_landslide_labels.py",
    "scripts/labels/build_wildfire_labels.py",
    "scripts/labels/build_weak_labels.py"
)) {
    Run $lb
}

# ── Step 3: Training ──
Log "=== Step 3: Model training ==="
Run "training/train_flood_v2.py"
Run "training/train_drought_v2.py"
Run "training/train_all_hazards_v2.py"

# ── Step 4: Evaluation ──
Log "=== Step 4: Evaluation ==="
Run "scripts/evaluation/compare_v1_v2.py"
Run "scripts/evaluation/ablation_study.py"
Run "scripts/evaluation/cross_region_test.py"

Log "=== Pipeline complete ==="
