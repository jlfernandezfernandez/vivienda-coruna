import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ensureSchema } from '../scripts/lib/db.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-db-migration-'));
  const path = join(dir, 'migration-test.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  return { db, dir, path };
}

// ── TIER 1: Category-Partition Tests ────────────────────────────────────────

test('Tier 1: ensureSchema on clean database creates all required tables and indexes', () => {
  const { db, dir } = createTempDb();
  try {
    ensureSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
      .sort();

    const expectedTables = [
      'cooperatives',
      'curation_reviews',
      'entity_aliases',
      'events',
      'gestora_promotions',
      'gestoras',
      'opportunities',
      'pipeline_runs',
      'sources',
    ].sort();

    assert.deepEqual(tables, expectedTables, 'All expected tables must be created on clean database');

    const sourceCols = db.prepare('PRAGMA table_info(sources)').all().map((c) => c.name);
    assert.ok(sourceCols.includes('checkedAt'), 'sources must include checkedAt column');
    assert.ok(sourceCols.includes('name'), 'sources must include name column');
    assert.ok(sourceCols.includes('url'), 'sources must include url column');
    assert.ok(sourceCols.includes('kind'), 'sources must include kind column');
    assert.ok(sourceCols.includes('ok'), 'sources must include ok column');
    assert.ok(sourceCols.includes('scanned'), 'sources must include scanned column');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 1: ensureSchema migration adds sources.checkedAt if missing from legacy database', () => {
  const { db, dir } = createTempDb();
  try {
    // Create legacy sources table without checkedAt
    db.exec(`
      CREATE TABLE sources (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        ok INTEGER NOT NULL,
        scanned INTEGER NOT NULL
      );
    `);

    // Insert legacy rows with missing checkedAt
    db.prepare('INSERT INTO sources (name, url, kind, ok, scanned) VALUES (?, ?, ?, ?, ?)')
      .run('DOG - Diario Oficial de Galicia', 'https://www.xunta.gal/dog/rss', 'official', 1, 12);
    db.prepare('INSERT INTO sources (name, url, kind, ok, scanned) VALUES (?, ?, ?, ?, ?)')
      .run('Prensa La Voz', 'https://lavozdegalicia.es/rss', 'market-alert', 1, 5);

    // Verify checkedAt does not exist initially
    let cols = db.prepare('PRAGMA table_info(sources)').all().map((c) => c.name);
    assert.ok(!cols.includes('checkedAt'), 'checkedAt should not exist in legacy schema before migration');

    // Run schema migration
    ensureSchema(db);

    // Verify checkedAt column was added
    cols = db.prepare('PRAGMA table_info(sources)').all().map((c) => c.name);
    assert.ok(cols.includes('checkedAt'), 'checkedAt column must be added after migration');

    // Verify existing rows had checkedAt backfilled with non-null timestamp
    const rows = db.prepare('SELECT name, checkedAt FROM sources').all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(row.checkedAt, `Row ${row.name} must have backfilled checkedAt`);
      assert.ok(!Number.isNaN(Date.parse(row.checkedAt)), `checkedAt should be valid ISO date: ${row.checkedAt}`);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── TIER 2: Boundary & Corner Cases ──────────────────────────────────────────

test('Tier 2: ensureSchema is completely idempotent on repeated executions', () => {
  const { db, dir } = createTempDb();
  try {
    // Run 1: clean init
    ensureSchema(db);
    // Populate some data
    db.prepare('INSERT INTO sources (name, url, kind, ok, scanned, checkedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('Fuente Test', 'https://example.test/rss', 'official', 1, 10, '2026-08-01T12:00:00Z');

    // Run 2: ensureSchema on existing populated database
    assert.doesNotThrow(() => ensureSchema(db), 'Subsequent ensureSchema calls must not throw');

    // Run 3: ensureSchema again
    assert.doesNotThrow(() => ensureSchema(db), 'Third ensureSchema call must not throw');

    // Verify row data preserved
    const row = db.prepare('SELECT * FROM sources WHERE name = ?').get('Fuente Test');
    assert.equal(row.checkedAt, '2026-08-01T12:00:00Z', 'Existing checkedAt must not be overwritten');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 2: ensureSchema backfills NULL checkedAt without overwriting existing checkedAt values', () => {
  const { db, dir } = createTempDb();
  try {
    ensureSchema(db);

    const explicitDate = '2026-05-15T08:30:00.000Z';
    db.prepare('INSERT INTO sources (name, url, kind, ok, scanned, checkedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('Source With Date', 'https://example.test/1', 'official', 1, 3, explicitDate);
    db.prepare('INSERT INTO sources (name, url, kind, ok, scanned, checkedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('Source Without Date', 'https://example.test/2', 'official', 1, 0, null);

    ensureSchema(db);

    const withDate = db.prepare('SELECT checkedAt FROM sources WHERE name = ?').get('Source With Date');
    const withoutDate = db.prepare('SELECT checkedAt FROM sources WHERE name = ?').get('Source Without Date');

    assert.equal(withDate.checkedAt, explicitDate, 'Explicit checkedAt must remain unchanged');
    assert.ok(withoutDate.checkedAt, 'NULL checkedAt must be backfilled');
    assert.notEqual(withoutDate.checkedAt, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── TIER 3: Cross-Feature Combinations ──────────────────────────────────────

test('Tier 3: legacy pipeline_runs migration upgrades CHECK constraint to support curate mode and preserves history', () => {
  const { db, dir } = createTempDb();
  try {
    // Create legacy pipeline_runs table with old check constraint (missing 'curate')
    db.exec(`
      CREATE TABLE pipeline_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('fast','deep')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
        idempotencyKey TEXT,
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        error TEXT
      );
    `);

    // Insert legacy run history
    db.prepare(`
      INSERT INTO pipeline_runs (id, mode, status, idempotencyKey, createdAt, startedAt, completedAt, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-legacy-1', 'fast', 'succeeded', 'idem-1', '2026-07-01T10:00:00Z', '2026-07-01T10:00:01Z', '2026-07-01T10:00:05Z', null);

    db.prepare(`
      INSERT INTO pipeline_runs (id, mode, status, idempotencyKey, createdAt, startedAt, completedAt, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-legacy-2', 'deep', 'failed', 'idem-2', '2026-07-02T10:00:00Z', '2026-07-02T10:00:01Z', '2026-07-02T10:00:06Z', 'Timeout error');

    // Run migration
    ensureSchema(db);

    // Verify existing runs are intact
    const run1 = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get('run-legacy-1');
    assert.equal(run1.mode, 'fast');
    assert.equal(run1.status, 'succeeded');
    assert.equal(run1.idempotencyKey, 'idem-1');

    const run2 = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get('run-legacy-2');
    assert.equal(run2.mode, 'deep');
    assert.equal(run2.status, 'failed');
    assert.equal(run2.error, 'Timeout error');

    // Verify new 'curate' mode is now supported without constraint failure
    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO pipeline_runs (id, mode, status, idempotencyKey, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).run('run-curate-1', 'curate', 'queued', 'idem-curate', '2026-08-21T12:00:00Z');
    }, 'pipeline_runs must allow mode="curate" after migration');

    const curateRun = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get('run-curate-1');
    assert.equal(curateRun.mode, 'curate');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 3: opportunities, gestora_promotions and cooperatives migrate missing columns across versions', () => {
  const { db, dir } = createTempDb();
  try {
    // Historical base tables prior to extended column migrations
    db.exec(`
      CREATE TABLE opportunities (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        sourceKind TEXT NOT NULL,
        publishedAt TEXT,
        firstSeenAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL,
        location TEXT,
        type TEXT,
        status TEXT,
        summary TEXT,
        precioMin INTEGER,
        precioMax INTEGER,
        habitacionesMin INTEGER,
        banosMin INTEGER,
        promotora TEXT,
        totalViviendas INTEGER,
        garaje INTEGER,
        trastero INTEGER,
        terraza INTEGER
      );

      CREATE TABLE gestoras (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        logo TEXT NOT NULL,
        website TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        address TEXT NOT NULL,
        description TEXT NOT NULL
      );

      CREATE TABLE gestora_promotions (
        id TEXT PRIMARY KEY,
        gestoraId TEXT NOT NULL,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        link TEXT,
        FOREIGN KEY(gestoraId) REFERENCES gestoras(id)
      );

      CREATE TABLE cooperatives (
        cif TEXT PRIMARY KEY,
        numRegistro TEXT,
        name TEXT NOT NULL,
        foundedAt TEXT,
        foundingPartners INTEGER,
        address TEXT,
        postalCode TEXT,
        municipality TEXT,
        email TEXT,
        phone TEXT,
        firstSeenAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL
      );
    `);

    // Run schema upgrade
    ensureSchema(db);

    // Verify opportunity columns
    const oppCols = db.prepare('PRAGMA table_info(opportunities)').all().map((c) => c.name);
    for (const col of [
      'piscina', 'ascensor', 'entregaEstimada', 'tipoPromocion', 'lat', 'lng',
      'municipality', 'barrio', 'geoPrecision', 'enriched', 'nombrePromocion',
      'promotionId', 'evidenceText', 'extractionMethod', 'extractorVersion'
    ]) {
      assert.ok(oppCols.includes(col), `opportunities table must include column '${col}'`);
    }

    // Verify gestora_promotions columns
    const promoCols = db.prepare('PRAGMA table_info(gestora_promotions)').all().map((c) => c.name);
    for (const col of [
      'entregaEstimada', 'buscaSocios', 'aportacionInicial', 'municipality',
      'barrio', 'lat', 'lng', 'geoPrecision', 'scopeStatus', 'precioMin', 'precioMax'
    ]) {
      assert.ok(promoCols.includes(col), `gestora_promotions table must include column '${col}'`);
    }

    // Verify cooperatives columns
    const coopCols = db.prepare('PRAGMA table_info(cooperatives)').all().map((c) => c.name);
    for (const col of ['barrio', 'lat', 'lng', 'geoPrecision', 'active']) {
      assert.ok(coopCols.includes(col), `cooperatives table must include column '${col}'`);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── TIER 4: Real-World Scenario Tests ────────────────────────────────────────

test('Tier 4: curation review placeholder screenshot invalidation transitions applied reviews to conflict', () => {
  const { db, dir } = createTempDb();
  try {
    ensureSchema(db);

    const placeholderSha = 'e878950f8091ec010cf5cc723bdea027a8539cf7147cfea199c2f666232dcd4e';
    const validSha = '1111111111111111111111111111111111111111111111111111111111111111';

    // Insert curation review with placeholder screenshot (applied)
    db.prepare(`
      INSERT INTO curation_reviews (
        id, entityKind, entityId, action, patchJson, evidenceJson, status, createdAt, appliedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rev-placeholder',
      'gestora',
      'gestora-fake',
      'update',
      '{}',
      JSON.stringify([{ type: 'screenshot', screenshot: { sha256: placeholderSha } }]),
      'applied',
      '2026-07-01T00:00:00Z',
      '2026-07-01T00:01:00Z'
    );

    // Insert curation review with valid screenshot (applied)
    db.prepare(`
      INSERT INTO curation_reviews (
        id, entityKind, entityId, action, patchJson, evidenceJson, status, createdAt, appliedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rev-valid',
      'gestora',
      'gestora-real',
      'update',
      '{}',
      JSON.stringify([{ type: 'screenshot', screenshot: { sha256: validSha } }]),
      'applied',
      '2026-07-01T00:00:00Z',
      '2026-07-01T00:01:00Z'
    );

    // Run ensureSchema (which runs the screenshot invalidation query)
    ensureSchema(db);

    const placeholderReview = db.prepare('SELECT status, notes FROM curation_reviews WHERE id = ?').get('rev-placeholder');
    const validReview = db.prepare('SELECT status, notes FROM curation_reviews WHERE id = ?').get('rev-valid');

    assert.equal(placeholderReview.status, 'conflict', 'Review with placeholder screenshot must be marked conflict');
    assert.match(placeholderReview.notes, /invalidated: placeholder screenshot detected/);

    assert.equal(validReview.status, 'applied', 'Review with valid screenshot must remain applied');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 4: unique and partial indexes are created and enforce constraints', () => {
  const { db, dir } = createTempDb();
  try {
    ensureSchema(db);

    // 1. Single running pipeline run index
    db.prepare(`
      INSERT INTO pipeline_runs (id, mode, status, createdAt, startedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run('run-active-1', 'fast', 'running', '2026-08-21T10:00:00Z', '2026-08-21T10:00:01Z');

    assert.throws(() => {
      db.prepare(`
        INSERT INTO pipeline_runs (id, mode, status, createdAt, startedAt)
        VALUES (?, ?, ?, ?, ?)
      `).run('run-active-2', 'deep', 'running', '2026-08-21T10:05:00Z', '2026-08-21T10:05:01Z');
    }, /UNIQUE/i, 'Only one pipeline run can have status="running" concurrently');

    // 2. Single staged curation review per entity
    db.prepare(`
      INSERT INTO curation_reviews (id, entityKind, entityId, action, patchJson, evidenceJson, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('cr-1', 'opportunity', 'opp-100', 'confirm', '{}', '[]', 'staged', '2026-08-21T10:00:00Z');

    assert.throws(() => {
      db.prepare(`
        INSERT INTO curation_reviews (id, entityKind, entityId, action, patchJson, evidenceJson, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('cr-2', 'opportunity', 'opp-100', 'update', '{}', '[]', 'staged', '2026-08-21T10:01:00Z');
    }, /UNIQUE/i, 'Only one staged review per entity can exist');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
