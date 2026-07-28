#!/usr/bin/env bash
# ── Runtime pipeline runner ─────────────────────────────────────────────────
# Invoked by the backend when a POST /api/v1/operations/runs is accepted.
# Runs the existing pipeline against a CANDIDATE database, then atomically
# promotes it if quality gate passes. No git/build/push — data-only.
#
# Usage: scripts/run-runtime-pipeline.sh <run-id> <mode:fast|deep> <db-path>
#
# Environment:
#   DB_PATH          — path to the LIVE SQLite database (read-only for serving)
#   CANDIDATE_PATH   — where to build the candidate (same volume as DB_PATH)
#   BACKUP_PATH      — where to store the pre-promotion backup
#   PROJECT_ROOT     — repo root (defaults to script dir's parent)
#   OPERATIONS_API_KEY — Bearer token for status callbacks (optional)

set -Eeuo pipefail

RUN_ID="${1:?run-id required}"
MODE="${2:?mode required}"
DB_PATH="${3:?db-path required}"

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CANDIDATE_PATH="${CANDIDATE_PATH:-${DB_PATH}.candidate}"
BACKUP_PATH="${BACKUP_PATH:-${DB_PATH}.backup}"
# Save the live path before we potentially overwrite DB_PATH
LIVE_DB_PATH="${DB_PATH}"

log() { echo "[runner][${RUN_ID}] $*" >&2; }

fail_run() {
  local msg="${1:-unknown error}"
  log "FAILED: ${msg}"
  # Mark the run as failed via the LIVE database
  node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('${LIVE_DB_PATH}');
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(\"UPDATE pipeline_runs SET status = 'failed', completedAt = ?, error = ? WHERE id = ? AND status = 'running'\")
      .run(new Date().toISOString(), '${msg//\'/\'\'}', '${RUN_ID}');
    db.close();
  " 2>/dev/null || true
  # Also catch interrupted runs
  node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('${LIVE_DB_PATH}');
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(\"UPDATE pipeline_runs SET status = 'interrupted', completedAt = ?, error = ? WHERE id = ? AND status = 'running'\")
      .run(new Date().toISOString(), '${msg//\'/\'\'}', '${RUN_ID}');
    db.close();
  " 2>/dev/null || true
  exit 1
}

# ── Mark run as running ────────────────────────────────────────────────────
log "Starting ${MODE} pipeline"
node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync('${LIVE_DB_PATH}');
  db.exec('PRAGMA foreign_keys = ON;');
  const result = db.prepare(\"UPDATE pipeline_runs SET status = 'running', startedAt = ? WHERE id = ? AND status = 'queued'\")
    .run(new Date().toISOString(), '${RUN_ID}');
  if (result.changes === 0) {
    console.error('Run ${RUN_ID} is not in queued state');
    process.exit(1);
  }
  db.close();
" || fail_run "Could not transition run to running"

# ── Backup live DB ──────────────────────────────────────────────────────────
log "Backing up live database"
cp "${LIVE_DB_PATH}" "${BACKUP_PATH}" || fail_run "Backup failed"

# ── VACUUM INTO candidate ───────────────────────────────────────────────────
log "Creating candidate database via VACUUM INTO"
node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync('${LIVE_DB_PATH}');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(\"VACUUM INTO '${CANDIDATE_PATH}'\");
  db.close();
" || fail_run "VACUUM INTO failed"

# ── Run pipeline against candidate ──────────────────────────────────────────
log "Running pipeline (${MODE}) against candidate"
export DB_PATH="${CANDIDATE_PATH}"

cd "${PROJECT_ROOT}"

if [[ "${MODE}" == "deep" ]]; then
  npm run refresh:all || fail_run "refresh:all failed"
  node scripts/reconcile-entities.mjs || fail_run "reconcile-entities failed"
  node scripts/repair-opportunity-grounding.mjs || fail_run "repair-opportunity-grounding failed"
  npm run enrich:retry || fail_run "enrich:retry failed"
  node scripts/repair-opportunity-grounding.mjs || fail_run "repair-opportunity-grounding (2) failed"
else
  npm run refresh:fast || fail_run "refresh:fast failed"
  node scripts/reconcile-entities.mjs || fail_run "reconcile-entities failed"
  node scripts/repair-opportunity-grounding.mjs || fail_run "repair-opportunity-grounding failed"
  npm run enrich:retry || fail_run "enrich:retry failed"
  node scripts/repair-opportunity-grounding.mjs || fail_run "repair-opportunity-grounding (2) failed"
fi

# ── Quality gate on candidate ───────────────────────────────────────────────
log "Running quality gate on candidate"
npm run quality || fail_run "Quality gate failed"

# ── Integrity + FK check ───────────────────────────────────────────────────
log "Checking integrity and foreign keys"
node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync('${CANDIDATE_PATH}');
  db.exec('PRAGMA foreign_keys = ON;');
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') {
    console.error('Integrity check failed:', integrity.integrity_check);
    process.exit(1);
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length > 0) {
    console.error('Foreign key violations:', fk.length);
    process.exit(1);
  }
  db.close();
" || fail_run "Integrity/FK check failed"

# ── Atomic promotion: rename candidate → live ───────────────────────────────
log "Promoting candidate to live"
mv "${CANDIDATE_PATH}" "${LIVE_DB_PATH}" || fail_run "Atomic rename failed"

# ── Mark run as succeeded ───────────────────────────────────────────────────
log "Pipeline completed successfully"
node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync('${LIVE_DB_PATH}');
  db.exec('PRAGMA foreign_keys = ON;');
  db.prepare(\"UPDATE pipeline_runs SET status = 'succeeded', completedAt = ? WHERE id = ? AND status = 'running'\")
    .run(new Date().toISOString(), '${RUN_ID}');
  db.close();
" || fail_run "Could not mark run as succeeded"

log "DONE — candidate promoted, run ${RUN_ID} succeeded"
