import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DatabaseSync } from 'node:sqlite';
import { createRepository, ensureSchema, createRun, getRunById, listRuns, getRunByIdempotencyKey, transitionRun, getRunningRun } from '../scripts/lib/db.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-backend-db-'));
  const path = join(dir, 'test.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  return { db, dir, path };
}

test('ensureSchema creates pipeline_runs table', () => {
  const { db, dir } = tempDb();
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_runs'").all();
    assert.equal(tables.length, 1, 'pipeline_runs table should exist');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createRun inserts a new run with queued status', () => {
  const { db, dir } = tempDb();
  try {
    const run = createRun(db, 'fast', null);
    assert.equal(run.status, 'queued');
    assert.equal(run.mode, 'fast');
    assert.ok(run.id);
    assert.ok(run.createdAt);

    const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(run.id);
    assert.equal(row.status, 'queued');
    assert.equal(row.mode, 'fast');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createRun with idempotency key returns existing run', () => {
  const { db, dir } = tempDb();
  try {
    const first = createRun(db, 'deep', 'key-xyz');
    const second = createRun(db, 'deep', 'key-xyz');
    assert.equal(second.id, first.id);
    assert.equal(second.status, first.status);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getRunById returns run or null', () => {
  const { db, dir } = tempDb();
  try {
    const run = createRun(db, 'fast', null);
    const found = getRunById(db, run.id);
    assert.equal(found.id, run.id);
    assert.equal(found.mode, 'fast');

    const missing = getRunById(db, 'nonexistent');
    assert.equal(missing, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listRuns returns all runs ordered by creation', () => {
  const { db, dir } = tempDb();
  try {
    createRun(db, 'fast', null);
    // Small delay to ensure distinct timestamps
    const start = Date.now();
    while (Date.now() === start) { /* busy-wait ~1ms */ }
    createRun(db, 'deep', null);
    const runs = listRuns(db);
    assert.ok(runs.length >= 2);
    // newest first
    assert.equal(runs[0].mode, 'deep');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getRunByIdempotencyKey returns run or null', () => {
  const { db, dir } = tempDb();
  try {
    createRun(db, 'fast', 'idem-1');
    const found = getRunByIdempotencyKey(db, 'idem-1');
    assert.equal(found.mode, 'fast');

    const missing = getRunByIdempotencyKey(db, 'nonexistent');
    assert.equal(missing, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transitionRun changes status from queued to running', () => {
  const { db, dir } = tempDb();
  try {
    const run = createRun(db, 'fast', null);
    const updated = transitionRun(db, run.id, 'queued', 'running');
    assert.equal(updated.status, 'running');
    assert.ok(updated.startedAt);

    const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(run.id);
    assert.equal(row.status, 'running');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transitionRun fails if current status does not match expected', () => {
  const { db, dir } = tempDb();
  try {
    const run = createRun(db, 'fast', null);
    // already queued, try to transition from running → succeeded (should fail)
    const result = transitionRun(db, run.id, 'running', 'succeeded');
    assert.equal(result, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transitionRun to succeeded sets completedAt', () => {
  const { db, dir } = tempDb();
  try {
    const run = createRun(db, 'fast', null);
    transitionRun(db, run.id, 'queued', 'running');
    const done = transitionRun(db, run.id, 'running', 'succeeded');
    assert.equal(done.status, 'succeeded');
    assert.ok(done.completedAt);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transitionRun to failed sets completedAt', () => {
  const { db, dir } = tempDb();
  try {
    const run = createRun(db, 'fast', null);
    transitionRun(db, run.id, 'queued', 'running');
    const failed = transitionRun(db, run.id, 'running', 'failed');
    assert.equal(failed.status, 'failed');
    assert.ok(failed.completedAt);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getRunningRun returns the single running run or null', () => {
  const { db, dir } = tempDb();
  try {
    assert.equal(getRunningRun(db), null);

    const run = createRun(db, 'fast', null);
    transitionRun(db, run.id, 'queued', 'running');
    const active = getRunningRun(db);
    assert.equal(active.id, run.id);
    assert.equal(active.status, 'running');

    transitionRun(db, run.id, 'running', 'succeeded');
    assert.equal(getRunningRun(db), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createRepository returns an object with all required methods', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const methods = ['health', 'dashboard', 'opportunityById', 'gestoras', 'gestoraById', 'cooperatives', 'municipalityBySlug', 'seoRoutes', 'createRun', 'listRuns', 'runById', 'sources', 'diagnostics'];
    for (const m of methods) {
      assert.equal(typeof repo[m], 'function', `${m} should be a function`);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.health returns database status', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const health = repo.health();
    assert.equal(health.database, 'ok');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.dashboard returns empty arrays on fresh db', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const dash = repo.dashboard();
    assert.ok(Array.isArray(dash.opportunities));
    assert.ok(Array.isArray(dash.sources));
    assert.ok(Array.isArray(dash.gestoras));
    assert.ok(Array.isArray(dash.cooperatives));
    assert.ok(Array.isArray(dash.events));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.createRun delegates to createRun and handles idempotency', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const r1 = repo.createRun('fast', 'key-1');
    const r2 = repo.createRun('fast', 'key-1');
    assert.equal(r1.id, r2.id);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.listRuns returns runs', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    repo.createRun('fast', null);
    const runs = repo.listRuns();
    assert.ok(runs.length >= 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.runById returns run or null', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const run = repo.createRun('deep', null);
    assert.equal(repo.runById(run.id).id, run.id);
    assert.equal(repo.runById('nope'), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.sources returns sources', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const sources = repo.sources();
    assert.ok(Array.isArray(sources));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository.diagnostics returns counts', () => {
  const { db, dir } = tempDb();
  try {
    const repo = createRepository(db);
    const diag = repo.diagnostics();
    assert.equal(typeof diag.opportunities, 'number');
    assert.equal(typeof diag.sources, 'number');
    assert.equal(typeof diag.gestoras, 'number');
    assert.equal(typeof diag.cooperatives, 'number');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository created from a factory closes the connection after every operation', () => {
  let closed = 0;
  const repo = createRepository(() => ({
    prepare: (sql) => {
      assert.match(sql, /integrity_check/);
      return { get: () => ({ integrity_check: 'ok' }) };
    },
    close: () => { closed += 1; },
  }));

  assert.deepEqual(repo.health(), { database: 'ok' });
  assert.equal(closed, 1);
});

test('repository dashboard includes presentation-ready municipalities and coverage', () => {
  const { db, dir } = tempDb();
  try {
    const coverage = { boundaries: [{ type: 'Feature' }], markers: [] };
    const repo = createRepository(db, { coverage });
    const dashboard = repo.dashboard();
    assert.equal(dashboard.municipalities.length, 9);
    assert.equal(dashboard.municipalities[0].slug, 'a-coruna');
    assert.deepEqual(dashboard.coverage, coverage);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema prevents two pipeline runs from being running simultaneously', () => {
  const { db, dir } = tempDb();
  try {
    const first = createRun(db, 'fast', 'single-writer-1');
    const second = createRun(db, 'deep', 'single-writer-2');
    assert.equal(transitionRun(db, first.id, 'queued', 'running').status, 'running');
    assert.throws(() => transitionRun(db, second.id, 'queued', 'running'), /UNIQUE|constraint/i);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gestora detail includes matching press opportunities', () => {
  const { db, dir } = tempDb();
  try {
    db.prepare('INSERT INTO gestoras (id, name, logo, website, phone, email, address, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('gestora-demo', 'Gestora Demo', 'GD', '', '', '', '', '');
    db.prepare(`INSERT INTO opportunities
      (id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, promotora)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'press-1', 'Gestora Demo inicia una nueva promoción', 'https://example.test/news',
      'Prensa local', 'market-alert', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', 'Gestora Demo'
    );

    const detail = createRepository(db).gestoraById('gestora-demo');
    assert.equal(detail.press.length, 1);
    assert.equal(detail.press[0].id, 'press-1');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
