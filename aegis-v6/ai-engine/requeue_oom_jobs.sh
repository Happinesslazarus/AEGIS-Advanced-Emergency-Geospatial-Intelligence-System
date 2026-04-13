#!/usr/bin/env bash
# requeue_oom_jobs.sh — re-run severe_storm and public_safety after memory frees up
# Run this after the main batch (flood/landslide/infra/envhazard/heatwave/wildfire/power_outage) finishes
set -e
cd "$(dirname "$0")"

VENV=".venv/Scripts/python"
LOGDIR="logs"
TS=$(date +%Y%m%d_%H%M%S)

echo "=== Re-queuing OOM jobs at $TS ==="

# Check available RAM (need at least 2 GB free)
FREE_KB=$(powershell.exe -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory" 2>/dev/null | tr -d '\r\n ')
FREE_GB=$(echo "scale=1; $FREE_KB/1024/1024" | bc 2>/dev/null || echo "unknown")
echo "Free RAM: ${FREE_GB} GB (${FREE_KB} KB)"

if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt 2097152 ]; then
    echo "WARNING: Less than 2 GB free. Proceeding anyway, but may OOM again."
fi

echo "Starting severe_storm re-train..."
nohup "$VENV" -m app.training.train_severe_storm_real --region uk-default \
    > "$LOGDIR/retrain_severe_storm_requeue_${TS}.log" 2>&1 &
SS_PID=$!
echo "severe_storm PID: $SS_PID"

echo "Waiting 120s before starting public_safety..."
sleep 120

echo "Starting public_safety re-train..."
nohup "$VENV" -m app.training.train_public_safety_incident_real --region uk-default \
    > "$LOGDIR/retrain_public_safety_requeue_${TS}.log" 2>&1 &
PS_PID=$!
echo "public_safety PID: $PS_PID"

echo "Both jobs launched. Monitor with:"
echo "  tail -f $LOGDIR/retrain_severe_storm_requeue_${TS}.log"
echo "  tail -f $LOGDIR/retrain_public_safety_requeue_${TS}.log"
