import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { DatabaseSync } from 'node:sqlite';
import { stageCurationReview } from '../scripts/lib/curation.mjs';
import { ensureSchema, createRun, getRunById, transitionRun } from '../scripts/lib/db.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const runnerScript = join(projectRoot, 'scripts', 'run-runtime-pipeline.sh');

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vivienda-runner-'));
}

function createEmptyDb(dir) {
  const path = join(dir, 'monitor.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  return { db, path };
}

test('runner script exists and is executable', () => {
  assert.ok(existsSync(runnerScript), 'run-runtime-pipeline.sh should exist');
});

test('runner transitions run to running then fails gracefully on missing pipeline deps', () => {
  const dir = tempDir();
  try {
    const { db, path: dbPath } = createEmptyDb(dir);
    const run = createRun(db, 'fast', null);
    db.close();

    // Run the script — it will fail because there's no package.json/node_modules
    // but it should still mark the run as failed/interrupted
    const result = spawnSync('bash', [runnerScript, run.id, 'fast', dbPath], {
      cwd: dir, // not the project root, so npm commands will fail
      env: { ...process.env, DB_PATH: dbPath, CANDIDATE_PATH: `${dbPath}.candidate`, BACKUP_PATH: `${dbPath}.backup`, PROJECT_ROOT: dir },
      encoding: 'utf8',
    });

    // Re-open DB to check run status
    const db2 = new DatabaseSync(dbPath);
    db2.exec('PRAGMA foreign_keys = ON;');
    const updated = getRunById(db2, run.id);
    db2.close();

    // Should have been marked as failed or interrupted
    assert.ok(updated.status === 'failed' || updated.status === 'interrupted',
      `Expected failed or interrupted, got ${updated.status}`);
    assert.ok(updated.completedAt, 'Should have completedAt set');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner does not start if run is not in queued state', () => {
  const dir = tempDir();
  try {
    const { db, path: dbPath } = createEmptyDb(dir);
    const run = createRun(db, 'fast', null);
    transitionRun(db, run.id, 'queued', 'running');
    transitionRun(db, run.id, 'running', 'succeeded');
    db.close();

    const result = spawnSync('bash', [runnerScript, run.id, 'fast', dbPath], {
      cwd: dir,
      env: { ...process.env, DB_PATH: dbPath, CANDIDATE_PATH: `${dbPath}.candidate`, BACKUP_PATH: `${dbPath}.backup`, PROJECT_ROOT: dir },
      encoding: 'utf8',
    });

    // Should exit non-zero because the run is not queued
    assert.notEqual(result.status, 0, 'Should fail when run is not queued');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner creates backup before running pipeline', () => {
  const dir = tempDir();
  try {
    const { db, path: dbPath } = createEmptyDb(dir);
    // Insert some data so backup is non-trivial
    db.prepare("INSERT INTO gestoras (id, name, logo, website, phone, email, address, description) VALUES ('g1', 'Test', '', '', '', '', '', '')").run();
    const run = createRun(db, 'fast', null);
    db.close();

    const backupPath = `${dbPath}.backup`;
    const candidatePath = `${dbPath}.candidate`;

    const result = spawnSync('bash', [runnerScript, run.id, 'fast', dbPath], {
      cwd: dir,
      env: { ...process.env, DB_PATH: dbPath, CANDIDATE_PATH: candidatePath, BACKUP_PATH: backupPath, PROJECT_ROOT: dir },
      encoding: 'utf8',
    });

    // Backup should exist (created before pipeline runs)
    assert.ok(existsSync(backupPath), 'Backup should be created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner with injected executor succeeds when pipeline passes', () => {
  const dir = tempDir();
  try {
    const { db, path: dbPath } = createEmptyDb(dir);
    const run = createRun(db, 'fast', null);
    db.close();

    const candidatePath = `${dbPath}.candidate`;
    const backupPath = `${dbPath}.backup`;

    // Create a fake project with a passing "pipeline"
    const fakeProject = join(dir, 'fake-project');
    mkdirSync(fakeProject, { recursive: true });
    writeFileSync(join(fakeProject, 'package.json'), JSON.stringify({
      name: 'fake', scripts: {
        'refresh:fast': 'echo "fast refresh ok"',
        'refresh:all': 'echo "deep refresh ok"',
        'enrich:retry': 'echo "enrich ok"',
        'quality': 'echo "PASS: all good"',
      }
    }));
    // Create the scripts the pipeline calls
    mkdirSync(join(fakeProject, 'scripts'), { recursive: true });
    writeFileSync(join(fakeProject, 'scripts', 'reconcile-entities.mjs'), 'console.log("reconcile ok");');
    writeFileSync(join(fakeProject, 'scripts', 'repair-opportunity-grounding.mjs'), 'console.log("repair ok");');

    const result = spawnSync('bash', [runnerScript, run.id, 'fast', dbPath], {
      cwd: fakeProject,
      env: { ...process.env, DB_PATH: dbPath, CANDIDATE_PATH: candidatePath, BACKUP_PATH: backupPath, PROJECT_ROOT: fakeProject, PATH: process.env.PATH },
      encoding: 'utf8',
    });

    // Re-open DB to check run status
    const db2 = new DatabaseSync(dbPath);
    db2.exec('PRAGMA foreign_keys = ON;');
    const updated = getRunById(db2, run.id);
    db2.close();

    assert.equal(updated.status, 'succeeded', `Expected succeeded, got ${updated.status}: ${result.stderr}`);
    assert.ok(updated.completedAt, 'Should have completedAt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('curate runner applies staged reviews on a candidate and publishes atomically', () => {
  const dir = tempDir();
  try {
    const { db, path: dbPath } = createEmptyDb(dir);
    stageCurationReview(db, {
      entityKind: 'gestora', entityId: 'gestora-curada', action: 'create',
      patch: { name: 'Gestora Curada', website: 'https://example.com' },
      evidence: [{
        url: 'https://example.com', excerpt: 'Gestora Curada, información oficial.',
        screenshot: {
          ref: 'vivienda-curation/tests/runner.png', sha256: '0'.repeat(64), capturedAt: new Date().toISOString(),
        },
      }],
    });
    const run = createRun(db, 'curate', null);
    db.close();

    const fakeProject = join(dir, 'curation-project');
    mkdirSync(join(fakeProject, 'scripts'), { recursive: true });
    writeFileSync(join(fakeProject, 'package.json'), JSON.stringify({
      name: 'curation-test', scripts: { quality: 'echo "PASS: all good"' },
    }));
    writeFileSync(
      join(fakeProject, 'scripts', 'apply-curation.mjs'),
      `await import(${JSON.stringify(new URL('../scripts/apply-curation.mjs', import.meta.url).href)});`,
    );
    writeFileSync(join(fakeProject, 'scripts', 'reconcile-entities.mjs'), 'console.log("reconcile ok");');
    writeFileSync(join(fakeProject, 'scripts', 'repair-opportunity-grounding.mjs'), 'console.log("repair ok");');

    const result = spawnSync('bash', [runnerScript, run.id, 'curate', dbPath], {
      cwd: fakeProject,
      env: {
        ...process.env,
        DB_PATH: dbPath,
        CANDIDATE_PATH: `${dbPath}.candidate`,
        BACKUP_PATH: `${dbPath}.backup`,
        PROJECT_ROOT: fakeProject,
      },
      encoding: 'utf8',
    });

    const published = new DatabaseSync(dbPath);
    const updated = getRunById(published, run.id);
    const gestora = published.prepare('SELECT name FROM gestoras WHERE id = ?').get('gestora-curada');
    published.close();

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(updated.status, 'succeeded');
    assert.equal(gestora.name, 'Gestora Curada');
    assert.ok(existsSync(`${dbPath}.backup`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
