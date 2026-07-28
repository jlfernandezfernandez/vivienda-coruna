#!/usr/bin/env bash
set -Eeuo pipefail

RUN_ID="${1:?run id required}"
MODE="${2:?mode required}"
LIVE_DB_PATH="${3:?live database path required}"
CODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$CODE_ROOT}"
STATE_SCRIPT="$CODE_ROOT/scripts/runtime-database.mjs"
CANDIDATE_PATH="${CANDIDATE_PATH:-${LIVE_DB_PATH}.${RUN_ID}.candidate}"
BACKUP_PATH="${BACKUP_PATH:-$(dirname "$LIVE_DB_PATH")/backups/${RUN_ID}.db}"

case "$MODE" in
  fast|deep) ;;
  *) printf 'invalid mode: %s\n' "$MODE" >&2; exit 64 ;;
esac

log() { printf '[runtime-pipeline] %s\n' "$*"; }
fail() {
  local exit_code=$?
  trap - ERR INT TERM
  rm -f -- "$CANDIDATE_PATH"
  node "$STATE_SCRIPT" fail "$LIVE_DB_PATH" "$RUN_ID" "pipeline exited with status $exit_code" || true
  exit "$exit_code"
}
trap fail ERR INT TERM

node "$STATE_SCRIPT" start "$LIVE_DB_PATH" "$RUN_ID"
mkdir -p -- "$(dirname "$BACKUP_PATH")" "$(dirname "$CANDIDATE_PATH")"
log "Creating consistent backup"
node "$STATE_SCRIPT" snapshot "$LIVE_DB_PATH" "$BACKUP_PATH"
log "Creating candidate database"
node "$STATE_SCRIPT" snapshot "$LIVE_DB_PATH" "$CANDIDATE_PATH"

export DB_PATH="$CANDIDATE_PATH"
export VIVIENDA_PIPELINE_LOCKED=1
cd "$PROJECT_ROOT"

if [[ "$MODE" == "fast" ]]; then
  npm run refresh:fast
  npm run enrich:retry
else
  npm run refresh:all
fi
node scripts/reconcile-entities.mjs
node scripts/repair-opportunity-grounding.mjs
npm run quality
node "$STATE_SCRIPT" check "$CANDIDATE_PATH"

log "Publishing candidate atomically"
node "$STATE_SCRIPT" promote "$CANDIDATE_PATH" "$LIVE_DB_PATH"
node "$STATE_SCRIPT" succeed "$LIVE_DB_PATH" "$RUN_ID"
trap - ERR INT TERM
log "Pipeline completed successfully"
