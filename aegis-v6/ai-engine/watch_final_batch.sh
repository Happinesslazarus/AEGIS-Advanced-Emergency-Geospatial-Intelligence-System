#!/usr/bin/env bash
# watch_final_batch.sh — monitors landslide/severe_storm/public_safety_incident/drought
# promotes each as it completes, then starts water_supply re-train
cd "$(dirname "$0")"

VENV=".venv/Scripts/python"
LOG="logs/watch_final_batch.log"
WATER_STARTED=0

log() { echo "$(date '+%H:%M') -- $*" | tee -a "$LOG"; }

# Return 0 if the hazard has any artifact with optimal_threshold != null
has_calibrated() {
    local hazard=$1
    for d in model_registry/${hazard}_uk-default_v*/; do
        [ -f "${d}metadata.json" ] || continue
        "$VENV" -c "
import json,sys
m=json.load(open(sys.argv[1]))
sys.exit(0 if m.get('optimal_threshold') is not None else 1)
" "${d}metadata.json" 2>/dev/null && return 0
    done
    return 1
}

# Return 0 if the newest calibrated artifact for this hazard is already in promotions.json
is_up_to_date() {
    local hazard=$1
    "$VENV" -c "
import json, sys
from pathlib import Path
p = json.load(open('model_registry/promotions.json'))
key = '${hazard}_uk-default'
# find newest calibrated artifact
for d in sorted(Path('model_registry').iterdir(), key=lambda x: x.name, reverse=True):
    if d.is_dir() and d.name.startswith(key + '_v'):
        mf = d / 'metadata.json'
        if mf.exists():
            m = json.load(open(mf))
            if m.get('optimal_threshold') is not None:
                sys.exit(0 if p.get(key) == m['version'] else 1)
sys.exit(1)
" 2>/dev/null
}

log "=== watch_final_batch started: monitoring landslide, severe_storm, public_safety_incident, drought ==="

while true; do
    CALIB=0
    for hazard in landslide severe_storm public_safety_incident drought; do
        has_calibrated "$hazard" && CALIB=$((CALIB+1))
    done
    log "$CALIB/4 hazards have calibrated artifacts"

    # Always run auto-promote to pick up any new completions
    "$VENV" auto_promote_calibrated.py 2>&1 | tee -a "$LOG"

    PROM=0
    for hazard in landslide severe_storm public_safety_incident drought; do
        is_up_to_date "$hazard" && PROM=$((PROM+1))
    done
    log "$PROM/4 of remaining hazards are promoted to latest calibrated version"

    if [ "$PROM" -ge 4 ] && [ "$WATER_STARTED" = "0" ]; then
        log "All 4 promoted! Starting water_supply_disruption re-train..."
        TS=$(date +%Y%m%d_%H%M%S)
        nohup "$VENV" -m app.training.train_water_supply_disruption_real --region uk-default \
            > "logs/retrain_water_supply_${TS}.log" 2>&1 &
        WATER_PID=$!
        WATER_STARTED=1
        log "water_supply PID: $WATER_PID -- logs/retrain_water_supply_${TS}.log"
        break
    fi

    sleep 300
done

log "watch_final_batch.sh complete."
