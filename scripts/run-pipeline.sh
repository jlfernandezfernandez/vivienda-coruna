#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-deep}"
REPO="/home/hermes/vpa-monitor"
LOCK_FILE="/tmp/vivienda-coruna-writer.lock"

if [[ "$MODE" != "deep" && "$MODE" != "fast" ]]; then
  echo "Uso: $0 [deep|fast]" >&2
  exit 64
fi

# Ambos cron y cualquier ejecución manual comparten este mutex.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Vivienda Coruña: otro escritor está activo; se omite esta ejecución."
  exit 0
fi
export VIVIENDA_PIPELINE_LOCKED=1

cd "$REPO"
DIRTY="$(git status --porcelain)"
if [[ -n "$DIRTY" ]]; then
  # Tras SIGKILL no se ejecuta el trap. Si el único cambio es la SQLite
  # versionada, es un snapshot parcial del pipeline anterior y se restaura.
  if [[ "$DIRTY" =~ ^[[:space:]M]{2}[[:space:]]src/data/monitor\.db$ ]]; then
    echo "Recuperando monitor.db parcial de una ejecución interrumpida."
    git restore --staged --worktree src/data/monitor.db
  else
    echo "Árbol Git sucio antes del pipeline; no se toca la base." >&2
    exit 1
  fi
fi

sync_remote() {
  git fetch origin master
  GIT_EDITOR=true git rebase --strategy-option theirs origin/master
}

push_with_retry() {
  if git push origin master; then return 0; fi
  echo "Push rechazado; rebaseando una vez sobre origin/master." >&2
  sync_remote
  git push origin master
}

sync_remote
START_SHA="$(git rev-parse HEAD)"
SUCCESS=0
cleanup() {
  if [[ "$SUCCESS" != 1 ]]; then
    echo "Pipeline fallido: restaurando el snapshot Git $START_SHA" >&2
    git rebase --abort >/dev/null 2>&1 || true
    git reset --hard "$START_SHA" >/dev/null
  fi
}
trap cleanup EXIT

if [[ "$MODE" == "deep" ]]; then
  npm run refresh:all
  node scripts/reconcile-entities.mjs
  node scripts/repair-opportunity-grounding.mjs
  npm run enrich:retry
  node scripts/repair-opportunity-grounding.mjs
else
  npm run refresh:fast
  node scripts/reconcile-entities.mjs
  node scripts/repair-opportunity-grounding.mjs
  npm run enrich:retry
  node scripts/repair-opportunity-grounding.mjs
fi

npm run quality
npm test
npm run build

if git diff --quiet -- src/data/monitor.db; then
  if [[ "$(git rev-list --count origin/master..HEAD)" -gt 0 ]]; then
    echo "Recuperando commit verificado pendiente de push."
    push_with_retry
  fi
  echo "Sin cambios de datos."
  SUCCESS=1
  exit 0
fi

git add src/data/monitor.db
git commit -m "chore(data): ${MODE} housing refresh"
if ! push_with_retry; then
  echo "Push rechazado; no se resuelve automáticamente un conflicto SQLite." >&2
  exit 1
fi

# El push ya dispara deploy.yml; este mensaje deja evidencia local del cierre.
SUCCESS=1
echo "Pipeline ${MODE} publicado correctamente."
