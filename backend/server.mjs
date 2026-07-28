import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

import { buildBackend } from './app.mjs';
import { createCoverageBuilder } from './coverage.mjs';
import { createRepository, ensureSchema } from '../scripts/lib/db.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const databasePath = resolve(process.env.DB_PATH || `${projectRoot}/src/data/monitor.db`);
const port = Number(process.env.PORT || 3000);
const operationsApiKey = process.env.OPERATIONS_API_KEY;

if (!operationsApiKey || operationsApiKey.length < 32) {
  throw new Error('OPERATIONS_API_KEY must contain at least 32 characters');
}

const bootstrap = new DatabaseSync(databasePath);
try {
  bootstrap.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(bootstrap);
} finally {
  bootstrap.close();
}

const geojson = JSON.parse(readFileSync(new URL('../public/coverage.geojson', import.meta.url), 'utf8'));
const repository = createRepository(
  () => new DatabaseSync(databasePath),
  { coverageBuilder: createCoverageBuilder(geojson) },
);

let draining = false;
let currentChild = null;

function runPipeline(run) {
  return new Promise((resolveRun) => {
    const child = spawn('bash', [
      `${projectRoot}/scripts/run-runtime-pipeline.sh`,
      run.id,
      run.mode,
      databasePath,
    ], {
      cwd: projectRoot,
      env: { ...process.env, PROJECT_ROOT: projectRoot },
      stdio: 'inherit',
    });
    currentChild = child;
    child.once('exit', () => {
      currentChild = null;
      resolveRun();
    });
  });
}

async function drainRuns() {
  if (draining) return;
  draining = true;
  try {
    while (!repository.runningRun()) {
      const queued = repository.nextQueuedRun();
      if (!queued) break;
      await runPipeline(queued);
    }
  } finally {
    draining = false;
    if (repository.nextQueuedRun()) void drainRuns();
  }
}

repository.interruptRunningRuns();
const app = buildBackend({
  repository,
  operationsApiKey,
  onRunCreated: () => { void drainRuns(); },
  logger: true,
});

await app.listen({ host: '0.0.0.0', port });
void drainRuns();

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  currentChild?.kill('SIGTERM');
  await app.close();
  process.exit(0);
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
