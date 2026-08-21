import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ensureSchema, getDatabase } from '../scripts/lib/db.mjs';
import { isGroundedEntityName } from '../scripts/lib/llm.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-stress-db-'));
  const dbPath = join(dir, 'stress-test.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return { db, dir, dbPath };
}

function runQualityGate(dbPath, envOverrides = {}) {
  try {
    const stdout = execFileSync('node', ['scripts/quality-gate.mjs'], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        DB_PATH: dbPath,
        ...envOverrides,
      },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. ADVERSARIAL SCHEMA MIGRATIONS & RESILIENCY
// ════════════════════════════════════════════════════════════════════════════

test('Adversarial Migration: ensureSchema on completely empty database creates schema cleanly', () => {
  const { db, dir } = createTempDb();
  try {
    assert.doesNotThrow(() => ensureSchema(db));
    const integrity = db.prepare('PRAGMA integrity_check').get();
    assert.equal(integrity.integrity_check, 'ok');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Migration: ensureSchema recovers from fragmented partial tables', () => {
  const { db, dir } = createTempDb();
  try {
    // Only create 2 tables with partial columns
    db.exec(`
      CREATE TABLE sources (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        ok INTEGER NOT NULL,
        scanned INTEGER NOT NULL
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
    `);

    // Insert data into partial tables
    db.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?)')
      .run('Fuente Parcial', 'https://example.test', 'official', 1, 0);

    // ensureSchema should complete all remaining 7 tables and add checkedAt to sources
    ensureSchema(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
    assert.equal(tables.length, 9, 'All 9 tables must be present');

    const source = db.prepare('SELECT * FROM sources WHERE name = ?').get('Fuente Parcial');
    assert.ok(source.checkedAt, 'checkedAt must be backfilled');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Migration: legacy pipeline_runs without mode column, old timestamps and 100 rows', () => {
  const { db, dir } = createTempDb();
  try {
    // Legacy schema without mode, with endedAt instead of completedAt
    db.exec(`
      CREATE TABLE pipeline_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'queued',
        startedAt TEXT,
        endedAt TEXT,
        error TEXT
      );
    `);

    // Seed 100 historical runs
    const insert = db.prepare('INSERT INTO pipeline_runs (id, status, startedAt, endedAt, error) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 100; i++) {
      insert.run(`legacy-${i}`, i % 2 === 0 ? 'succeeded' : 'failed', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', i % 2 === 0 ? null : 'err');
    }

    ensureSchema(db);

    const count = db.prepare('SELECT COUNT(*) n FROM pipeline_runs').get().n;
    assert.equal(count, 100, 'All 100 historical runs must be preserved');

    const sample = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get('legacy-10');
    assert.equal(sample.mode, 'fast', 'Default mode fast should be assigned');
    assert.equal(sample.completedAt, '2026-01-01T00:01:00Z', 'endedAt should be mapped to completedAt');
    assert.ok(sample.createdAt, 'createdAt should be backfilled');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Migration: malformed and corrupt JSON in curation_reviews evidenceJson handled safely', () => {
  const { db, dir } = createTempDb();
  try {
    ensureSchema(db);

    const placeholderSha = 'e878950f8091ec010cf5cc723bdea027a8539cf7147cfea199c2f666232dcd4e';
    const insert = db.prepare(`
      INSERT INTO curation_reviews (id, entityKind, entityId, action, patchJson, evidenceJson, status, createdAt, appliedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Test cases with corrupt / weird evidenceJson
    const testCases = [
      { id: 'c-invalid-json', json: '{ invalid JSON :: %$#', expectedStatus: 'applied' },
      { id: 'c-plain-num', json: '12345', expectedStatus: 'applied' },
      { id: 'c-plain-str', json: '"just a string"', expectedStatus: 'applied' },
      { id: 'c-empty-obj', json: '{}', expectedStatus: 'applied' },
      { id: 'c-empty-arr', json: '[]', expectedStatus: 'applied' },
      { id: 'c-mixed-arr', json: '[null, true, false, 123, "text", [], {}]', expectedStatus: 'applied' },
      { id: 'c-null-screenshot', json: '[{"type": "screenshot", "screenshot": null}]', expectedStatus: 'applied' },
      { id: 'c-valid-placeholder', json: JSON.stringify([{ type: 'screenshot', screenshot: { sha256: placeholderSha } }]), expectedStatus: 'conflict' },
    ];

    for (const tc of testCases) {
      insert.run(tc.id, 'gestora', `g-${tc.id}`, 'confirm', '{}', tc.json, 'applied', '2026-08-01T00:00:00Z', '2026-08-01T00:01:00Z');
    }

    // Run ensureSchema to trigger screenshot invalidation query
    assert.doesNotThrow(() => ensureSchema(db), 'Corrupt JSON in evidenceJson must not throw during migration');

    for (const tc of testCases) {
      const row = db.prepare('SELECT status, notes FROM curation_reviews WHERE id = ?').get(tc.id);
      assert.equal(row.status, tc.expectedStatus, `Review ${tc.id} status should be ${tc.expectedStatus}`);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Stress: 50 consecutive ensureSchema calls on populated database', () => {
  const { db, dir } = createTempDb();
  try {
    ensureSchema(db);

    db.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?)')
      .run('DOG', 'https://www.xunta.gal/dog/rss', 'official', 1, 5, '2026-08-20T10:00:00Z');

    for (let i = 0; i < 50; i++) {
      assert.doesNotThrow(() => ensureSchema(db), `ensureSchema call #${i + 1} failed`);
    }

    const row = db.prepare('SELECT * FROM sources WHERE name = ?').get('DOG');
    assert.equal(row.checkedAt, '2026-08-20T10:00:00Z', 'checkedAt should never be overwritten on repeated calls');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. ADVERSARIAL QUALITY GATE STRESS TESTS
// ════════════════════════════════════════════════════════════════════════════

function setupBaseQualityDb() {
  const { db, dir, dbPath } = createTempDb();
  ensureSchema(db);

  db.prepare(`
    INSERT INTO sources (name, url, kind, ok, scanned, checkedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('DOG', 'https://www.xunta.gal/dog/rss', 'official', 1, 5, new Date().toISOString());

  db.prepare(`
    INSERT INTO sources (name, url, kind, ok, scanned, checkedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('Prensa Local', 'https://example.test/rss', 'market-alert', 1, 3, new Date().toISOString());

  db.prepare(`
    INSERT INTO gestoras (id, name, logo, website, phone, email, address, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('g-1', 'Gestora Alfa', 'GA', 'https://alfa.test', '981111111', 'info@alfa.test', 'A Coruña', 'Promotora');

  db.prepare(`
    INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('p-1', 'g-1', 'Residencial Alfa', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope');

  db.prepare(`
    INSERT INTO opportunities (
      id, title, url, source, sourceKind, firstSeenAt, lastSeenAt,
      location, status, precioMin, precioMax, municipality, promotionId, evidenceText
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'opp-1', 'Promoción Alfa', 'https://example.test/p1', 'DOG', 'official',
    new Date().toISOString(), new Date().toISOString(), 'A Coruña', 'En construcción',
    200000, 300000, 'A Coruña', 'p-1', 'Promoción Alfa desde 200000 €'
  );

  db.prepare(`
    INSERT INTO cooperatives (cif, name, firstSeenAt, lastSeenAt, active, municipality)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run('F99999999', 'Coop Valida', new Date().toISOString(), new Date().toISOString(), 'A Coruña');

  return { db, dir, dbPath };
}

test('Adversarial Quality Gate: Price boundary limits (99,999 vs 100,000 & 2,000,000 vs 2,000,001)', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    // 1. Valid exact boundary prices
    db.prepare("UPDATE opportunities SET precioMin = 100000, precioMax = 2000000 WHERE id = 'opp-1'").run();
    let res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 0, 'Exact boundaries 100,000 and 2,000,000 should pass quality gate');

    // 2. precioMin = 99,999 (1 euro below limit)
    db.prepare("UPDATE opportunities SET precioMin = 99999 WHERE id = 'opp-1'").run();
    res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'precioMin 99,999 must fail');
    assert.match(res.stderr, /precios imposibles/);

    // 3. precioMin = 2,000,001 (1 euro above min limit)
    db.prepare("UPDATE opportunities SET precioMin = 2000001, precioMax = 2500000 WHERE id = 'opp-1'").run();
    res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'precioMin 2,000,001 must fail');
    assert.match(res.stderr, /precios imposibles/);

    // 4. precioMax = 3,000,001 (1 euro above max limit)
    db.prepare("UPDATE opportunities SET precioMin = 200000, precioMax = 3000001 WHERE id = 'opp-1'").run();
    res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'precioMax 3,000,001 must fail');
    assert.match(res.stderr, /precios imposibles/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Special regex metacharacters in entity names do not break grounding', () => {
  // Test grounding utility with regex chars
  const strangeNames = [
    'Promotora (Galicia) [2026] + Cía.',
    'Promociones & Inversiones S.L.?',
    'Urbanización *Los Rosales* ^2',
    'Edificio $100 | Fase 1',
  ];

  for (const name of strangeNames) {
    const text = `La empresa ${name} inicia la construcción en A Coruña.`;
    assert.doesNotThrow(() => {
      const grounded = isGroundedEntityName(name, text, 'company');
      assert.equal(grounded, name, `Special regex character name "${name}" should ground cleanly`);
    });
  }
});

test('Adversarial Quality Gate: Normalized promotion duplicate collisions across accents and spacing', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    db.prepare(`
      INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('p-dup', 'g-1', '   rÉsîdèncïal   Álfa  ', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope');

    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'Accent/case/space collapsed duplicate must be detected');
    assert.match(res.stderr, /grupos de promociones exactamente duplicadas/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Source staleness exact boundary (29 hours vs 31 hours)', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    // 29 hours ago (<30h threshold)
    const h29 = new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sources SET checkedAt = ?').run(h29);

    let res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 0, 'Sources updated 29h ago should pass quality gate');

    // 31 hours ago (>30h threshold)
    const h31 = new Date(Date.now() - 31 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sources SET checkedAt = ?').run(h31);

    res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'Sources updated 31h ago should fail standalone quality gate');
    assert.match(res.stderr, /fuentes sin comprobación en las últimas 30 horas/);

    // Under pipeline lock: non-blocking warning
    res = runQualityGate(dbPath, { VIVIENDA_PIPELINE_LOCKED: '1' });
    assert.equal(res.exitCode, 0, 'Sources updated 31h ago under pipeline lock should be non-blocking WARN');
    assert.match(res.stdout, /WARN: .* fuentes sin comprobación en las últimas 30 horas/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3. ADVERSARIAL SECRET & ENVIRONMENT VALIDATION
// ════════════════════════════════════════════════════════════════════════════

function executeDeployScript(envOverrides = {}) {
  return new Promise((resolve) => {
    const scriptPath = join(import.meta.dirname, '../scripts/deploy-coolify.mjs');
    const child = spawn('node', [scriptPath], {
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

test('Adversarial Migration: opportunities missing all 14 extra columns simultaneously preserves row data', () => {
  const { db, dir } = createTempDb();
  try {
    // Legacy base table without the 14 extended columns
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
    `);

    // Insert 20 legacy opportunities
    const insert = db.prepare(`
      INSERT INTO opportunities (
        id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location, status, precioMin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < 20; i++) {
      insert.run(`opp-legacy-${i}`, `Piso ${i}`, `https://example.test/${i}`, 'DOG', 'official', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'A Coruña', 'En construcción', 200000 + i * 10000);
    }

    ensureSchema(db);

    const cols = db.prepare('PRAGMA table_info(opportunities)').all().map((c) => c.name);
    for (const expectedCol of [
      'piscina', 'ascensor', 'entregaEstimada', 'tipoPromocion', 'lat', 'lng',
      'municipality', 'barrio', 'geoPrecision', 'enriched', 'nombrePromocion',
      'promotionId', 'evidenceText', 'extractionMethod'
    ]) {
      assert.ok(cols.includes(expectedCol), `Missing column ${expectedCol} after bulk migration`);
    }

    const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-legacy-5');
    assert.equal(row.title, 'Piso 5');
    assert.equal(row.precioMin, 250000);
    assert.equal(row.piscina, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Migration: cooperatives missing active and geo columns migrates with default active=1', () => {
  const { db, dir } = createTempDb();
  try {
    db.exec(`
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

    db.prepare(`
      INSERT INTO cooperatives (cif, name, firstSeenAt, lastSeenAt)
      VALUES (?, ?, ?, ?)
    `).run('F00000001', 'Coop Antigua', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    ensureSchema(db);

    const coopCols = db.prepare('PRAGMA table_info(cooperatives)').all().map((c) => c.name);
    assert.ok(coopCols.includes('active'));
    assert.ok(coopCols.includes('lat'));
    assert.ok(coopCols.includes('lng'));
    assert.ok(coopCols.includes('barrio'));
    assert.ok(coopCols.includes('geoPrecision'));

    const row = db.prepare('SELECT active FROM cooperatives WHERE cif = ?').get('F00000001');
    assert.equal(row.active, 1, 'Default active=1 must apply to migrated rows');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Detects opportunity source missing from sources table', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    db.prepare(`
      INSERT INTO opportunities (
        id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location, status, precioMin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('opp-ghost-source', 'Piso Ghost', 'https://ghost.test', 'GhostSourceNonExistent', 'market-alert', new Date().toISOString(), new Date().toISOString(), 'A Coruña', 'En construcción', 220000);

    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'Missing source in sources table must fail quality gate');
    assert.match(res.stderr, /fuentes de oportunidades sin trazabilidad en sources/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Detects resurrected rejected promotion', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    // Add alias marking p-rejected as __rejected__
    db.prepare(`
      INSERT INTO entity_aliases (entityKind, aliasId, canonicalId, reason, createdAt)
      VALUES ('promotion', 'p-rejected', '__rejected__', 'invalid test', ?)
    `).run(new Date().toISOString());

    // Insert p-rejected into gestora_promotions
    db.prepare(`
      INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
      VALUES ('p-rejected', 'g-1', 'Promo Rechazada', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope')
    `).run();

    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'Resurrected rejected promotion must fail quality gate');
    assert.match(res.stderr, /promociones rechazadas han reaparecido/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Detects stale events contradicting current status or price', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    // Insert event with status 'Entregada' while opportunity is 'En construcción'
    db.prepare(`
      INSERT INTO events (detectedAt, entityKind, entityId, kind, label, oldValue, newValue)
      VALUES (?, 'opportunity', 'opp-1', 'status', 'Estado cambiado', 'En construcción', 'Entregada')
    `).run(new Date().toISOString());

    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'Stale event contradicting current entity state must fail quality gate');
    assert.match(res.stderr, /eventos contradicen el estado actual/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Detects orphan events referencing nonexistent entities', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    db.prepare(`
      INSERT INTO events (detectedAt, entityKind, entityId, kind, label, oldValue, newValue)
      VALUES (?, 'opportunity', 'opp-deleted-ghost', 'new', 'Nueva oportunidad', null, null)
    `).run(new Date().toISOString());

    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, 'Orphan events referencing nonexistent entities must fail quality gate');
    assert.match(res.stderr, /eventos apuntan a entidades no publicables/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Majority source failures (>50%) trigger fatal error', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    // 2 sources in baseline: mark both ok = 0 (100% fail)
    db.prepare('UPDATE sources SET ok = 0').run();
    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 1, '100% source failure must fail quality gate');
    assert.match(res.stderr, /2\/2 fuentes fallan/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Adversarial Quality Gate: Minority source failures (<=50%) produce non-blocking warning', () => {
  const { db, dir, dbPath } = setupBaseQualityDb();
  try {
    // Add a third source so total is 3, make 1 fail (33% <= 50%)
    db.prepare(`
      INSERT INTO sources (name, url, kind, ok, scanned, checkedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Fuente 3', 'https://example3.test', 'official', 1, 0, new Date().toISOString());

    db.prepare("UPDATE sources SET ok = 0 WHERE name = 'DOG'").run();

    const res = runQualityGate(dbPath);
    assert.equal(res.exitCode, 0, '1/3 source failure should pass quality gate with warning');
    assert.match(res.stdout, /WARN: 1\/3 fuentes fallan actualmente/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3. ADVERSARIAL SECRET & ENVIRONMENT VALIDATION
// ════════════════════════════════════════════════════════════════════════════

test('Adversarial Secret: deploy-coolify rejects missing COOLIFY_TOKEN immediately', async () => {
  const env = { ...process.env };
  delete env.COOLIFY_TOKEN;
  const res = await executeDeployScript(env);
  assert.notEqual(res.exitCode, 0);
  assert.match(res.stderr + res.stdout, /COOLIFY_TOKEN environment variable is required/);
});

test('Adversarial Secret: deploy-coolify rejects empty string COOLIFY_TOKEN immediately', async () => {
  const res = await executeDeployScript({ COOLIFY_TOKEN: '' });
  assert.notEqual(res.exitCode, 0);
  assert.match(res.stderr + res.stdout, /COOLIFY_TOKEN environment variable is required/);
});


