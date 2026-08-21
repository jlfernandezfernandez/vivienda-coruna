import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ensureSchema } from '../scripts/lib/db.mjs';

function createHealthyTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-qg-test-'));
  const dbPath = join(dir, 'test-quality.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);

  // Seed baseline valid data
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
  `).run('gestora-1', 'Gestora Coruña', 'GC', 'https://gestora.test', '981000000', 'info@gestora.test', 'A Coruña', 'Promotora');

  db.prepare(`
    INSERT INTO gestora_promotions (
      id, gestoraId, name, location, status, municipality, scopeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('promo-1', 'gestora-1', 'Residencial Riazor', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope');

  db.prepare(`
    INSERT INTO opportunities (
      id, title, url, source, sourceKind, firstSeenAt, lastSeenAt,
      location, status, precioMin, precioMax, municipality, promotionId,
      evidenceText
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'opp-1', 'Nueva promoción en Riazor', 'https://example.test/p1', 'DOG', 'official',
    new Date().toISOString(), new Date().toISOString(), 'A Coruña', 'En construcción',
    250000, 350000, 'A Coruña', 'promo-1', 'Nueva promoción en Riazor con precio desde 250000 €'
  );

  db.prepare(`
    INSERT INTO cooperatives (
      cif, name, firstSeenAt, lastSeenAt, active, municipality
    ) VALUES (?, ?, ?, ?, 1, ?)
  `).run('F12345678', 'S. Coop. Galega Marineda', new Date().toISOString(), new Date().toISOString(), 'A Coruña');

  return { db, dir, dbPath };
}

function runQualityGateScript(dbPath, envOverrides = {}) {
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

// ── TIER 1: Category-Partition Tests ────────────────────────────────────────

test('Tier 1: quality gate passes cleanly on a fully healthy database with exit code 0', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 0, `Quality gate should exit 0 on clean DB. Stderr: ${result.stderr}`);
    assert.match(result.stdout, /PASS: integridad, ámbito, estados, precios y duplicados exactos correctos/);
    assert.doesNotMatch(result.stderr, /ERROR:/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 1: quality gate catches foreign key violations', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // Temporarily turn off foreign keys to inject a corrupted foreign key reference
    db.exec('PRAGMA foreign_keys = OFF;');
    db.prepare(`
      INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('promo-broken-fk', 'gestora-nonexistent', 'Promo Huérfana', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope');

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1, 'Quality gate must fail on foreign key violation');
    assert.match(result.stderr, /violaciones de claves foráneas/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 1: quality gate catches opportunities outside valid territorial scope', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    db.prepare(`
      INSERT INTO opportunities (
        id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('opp-madrid', 'Piso en Madrid Centro', 'https://example.test/madrid', 'DOG', 'official', new Date().toISOString(), new Date().toISOString(), 'Madrid Centro');

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1, 'Quality gate must fail when opportunity location is outside metropolitan scope');
    assert.match(result.stderr, /oportunidades fuera del ámbito o sin municipio canónico/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── TIER 2: Boundary & Corner Cases ──────────────────────────────────────────

test('Tier 2: quality gate detects impossible price boundaries and inverted ranges', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // 1. precioMin below boundary (< 100,000)
    db.prepare(`
      INSERT INTO opportunities (id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location, precioMin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('opp-cheap', 'Plaza garaje o precio absurdo', 'https://example.test/1', 'DOG', 'official', new Date().toISOString(), new Date().toISOString(), 'A Coruña', 5000);

    let result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /oportunidades con precios imposibles/);

    // Clean up
    db.prepare('DELETE FROM opportunities WHERE id = ?').run('opp-cheap');

    // 2. Inverted price range (precioMax < precioMin)
    db.prepare(`
      INSERT INTO opportunities (id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location, precioMin, precioMax)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('opp-inverted', 'Rango invertido', 'https://example.test/2', 'DOG', 'official', new Date().toISOString(), new Date().toISOString(), 'A Coruña', 400000, 200000);

    result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /oportunidades con precios imposibles/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 2: quality gate detects non-canonical opportunity status values', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    db.prepare(`
      INSERT INTO opportunities (id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('opp-bad-status', 'Promo con estado inválido', 'https://example.test/bad', 'DOG', 'official', new Date().toISOString(), new Date().toISOString(), 'A Coruña', 'Estado Desconocido e Inventado');

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /oportunidades con estado no canónico/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 2: quality gate detects visible in_scope promotions missing municipality', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    db.prepare(`
      INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('promo-no-muni', 'gestora-1', 'Promo sin municipio', 'Desconocido', 'En construcción', null, 'in_scope');

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /promociones publicables sin municipio canónico/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── TIER 3: Cross-Feature Combinations ──────────────────────────────────────

test('Tier 3: quality gate detects duplicate promotions under same gestora and municipality', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // Insert duplicate promotion with normalized name collision
    db.prepare(`
      INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('promo-dup-1', 'gestora-1', 'Residencial Riazor 2', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope');

    db.prepare(`
      INSERT INTO gestora_promotions (id, gestoraId, name, location, status, municipality, scopeStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('promo-dup-2', 'gestora-1', 'residencial-riazor-2', 'A Coruña', 'En construcción', 'A Coruña', 'in_scope');

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /grupos de promociones exactamente duplicadas/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 3: quality gate detects orphan entity aliases and orphan opportunity promotion links', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // 1. Orphan alias
    db.prepare(`
      INSERT INTO entity_aliases (entityKind, aliasId, canonicalId, reason, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run('promotion', 'alias-promo-missing', 'canonical-promo-nonexistent', 'dedup test', new Date().toISOString());

    let result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /alias de promoción apuntan a entidades inexistentes/);

    db.prepare('DELETE FROM entity_aliases WHERE aliasId = ?').run('alias-promo-missing');

    // 2. Orphan promotion link from opportunity
    db.prepare(`
      INSERT INTO opportunities (
        id, title, url, source, sourceKind, firstSeenAt, lastSeenAt, location, promotionId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('opp-orphan-promo', 'Piso ligado a nada', 'https://example.test/link', 'DOG', 'official', new Date().toISOString(), new Date().toISOString(), 'A Coruña', 'promo-ghost');

    result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /oportunidades apuntan a promociones inexistentes/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 3: quality gate detects ungrounded entity fields when promotora or nombrePromocion lack textual evidence', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // Insert opportunity without promotionId where promotora is hallucinated/not in evidence
    db.prepare(`
      INSERT INTO opportunities (
        id, title, url, source, sourceKind, firstSeenAt, lastSeenAt,
        location, promotora, evidenceText
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'opp-hallucinated-promotora',
      'Venta de pisos en Monte Alto',
      'https://example.test/montealto',
      'DOG',
      'official',
      new Date().toISOString(),
      new Date().toISOString(),
      'A Coruña',
      'Promotora Fantasma No Mencionada S.L.',
      'Edificio residencial de 12 viviendas con garaje en Monte Alto'
    );

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /campos de entidad sin evidencia almacenada/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── TIER 4: Real-World Scenarios ─────────────────────────────────────────────

test('Tier 4: quality gate handles stale sources: error in standalone mode vs non-blocking warning under pipeline lock', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // Set checkedAt to 40 hours ago (>30h staleness threshold)
    const fortyHoursAgo = new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sources SET checkedAt = ?').run(fortyHoursAgo);

    // Standalone mode: stale sources trigger ERROR and exit 1
    const standaloneResult = runQualityGateScript(dbPath, { VIVIENDA_PIPELINE_LOCKED: '' });
    assert.equal(standaloneResult.exitCode, 1, 'Stale sources in standalone mode should fail quality gate');
    assert.match(standaloneResult.stderr, /fuentes sin comprobación en las últimas 30 horas/);

    // Pipeline locked mode (e.g. curate run): stale sources trigger non-blocking WARN and exit 0
    const pipelineResult = runQualityGateScript(dbPath, { VIVIENDA_PIPELINE_LOCKED: '1' });
    assert.equal(pipelineResult.exitCode, 0, 'Stale sources under VIVIENDA_PIPELINE_LOCKED should be non-blocking warning');
    assert.match(pipelineResult.stdout, /WARN: .* fuentes sin comprobación en las últimas 30 horas \(pipeline — no bloqueante\)/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tier 4: quality gate detects when majority (>50%) of ingestion sources fail', () => {
  const { db, dir, dbPath } = createHealthyTempDb();
  try {
    // Make both sources fail (2 out of 2)
    db.prepare('UPDATE sources SET ok = 0').run();

    const result = runQualityGateScript(dbPath);
    assert.equal(result.exitCode, 1, 'Quality gate must fail when majority of sources are down');
    assert.match(result.stderr, /2\/2 fuentes fallan/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
