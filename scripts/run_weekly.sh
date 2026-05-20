#!/usr/bin/env bash
# Wöchentlicher Pipeline-Lauf (Cronjob-Wrapper).
# - Holt Code-Updates per `git pull --ff-only`
# - Startet die Docker-Compose-Pipeline mit dem externen PBF-Verzeichnis
# - Schreibt timestamp-Logs unter logs/

set -euo pipefail

REPO="/home/simon/mapillary_coverage_analysis"
OSM_DIR="/home/simon/mapillary_coverage/data/osm/processed"
LOG_DIR="$REPO/logs"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/pipeline_$(date +%Y%m%d_%H%M%S).log"

cd "$REPO"

{
  echo "=== $(date -Iseconds)  START weekly pipeline ==="
  echo "Host: $(hostname), User: $(id -un)"
  echo
  echo "--- git pull ---"
  git pull --ff-only origin main
  echo
  echo "--- docker compose run ---"
  OSM_DIR="$OSM_DIR" docker compose run --rm pipeline
  echo
  echo "=== $(date -Iseconds)  DONE ==="
} &>> "$LOG_FILE"
