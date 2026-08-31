import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { buildBackend } from '../backend/app.mjs';
import { ensureSchema, addBlockedHost, listBlockedHosts } from '../scripts/lib/db.mjs';
import { isTrustedOpportunityUrl } from '../scripts/lib/monitor.mjs';

const operationsToken = 'test-token';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-blocked-hosts-'));
  const path = join(dir, 'test.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  return { db, dir, path };
}

test('addBlockedHost valida y persiste un dominio bloqueado', () => {
  const { db, dir } = tempDb();
  try {
    addBlockedHost(db, 'portal-basura.test', 'Portal index page');
    const rows = listBlockedHosts(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].domain, 'portal-basura.test');
    assert.equal(rows[0].reason, 'Portal index page');
    assert.equal(rows[0].severity, 'block');
    assert.ok(rows[0].created_at);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addBlockedHost rechta dominios vacíos, con esquema o con path', () => {
  const { db, dir } = tempDb();
  try {
    assert.throws(() => addBlockedHost(db, '', 'vacío'), /invalid_domain/);
    assert.throws(() => addBlockedHost(db, 'https://ejemplo.com', 'con esquema'), /invalid_domain/);
    assert.throws(() => addBlockedHost(db, 'ejemplo.com/ruta', 'con path'), /invalid_domain/);
    assert.throws(() => addBlockedHost(db, 'ejemplo.com?query=1', 'con query'), /invalid_domain/);
    assert.throws(() => addBlockedHost(db, '192.168.1.1', 'IP literal'), /invalid_domain/);
    assert.throws(() => addBlockedHost(db, '2001:db8::1', 'IPv6 literal'), /invalid_domain/);
    assert.equal(listBlockedHosts(db).length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isTrustedOpportunityUrl rechaza un dominio de la tabla blocked_hosts', () => {
  const { db, dir } = tempDb();
  try {
    addBlockedHost(db, 'nuevo-portal-ruido.test', 'Nuevo portal index');
    const blocked = listBlockedHosts(db);
    assert.equal(isTrustedOpportunityUrl('https://nuevo-portal-ruido.test/promo', blocked), false);
    assert.equal(isTrustedOpportunityUrl('https://www.nuevo-portal-ruido.test/promo', blocked), false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isTrustedOpportunityUrl no sobre-bloquea fuentes legítimas', () => {
  const { db, dir } = tempDb();
  try {
    addBlockedHost(db, 'solo-este.test', 'Basura');
    const blocked = listBlockedHosts(db);
    assert.equal(isTrustedOpportunityUrl('https://www.laopinioncoruna.es/noticia', blocked), true);
    assert.equal(isTrustedOpportunityUrl('https://igvs.xunta.gal/arteixo', blocked), true);
    assert.equal(isTrustedOpportunityUrl('https://solo-este.test/noticia', blocked), false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy BLOCKED_OPPORTUNITY_HOSTS sigue bloqueando sin consultar la BD', () => {
  assert.equal(isTrustedOpportunityUrl('https://www.idealista.com/pisos/a-coruna/'), false);
  assert.equal(isTrustedOpportunityUrl('https://inmobiliariamarten.com/obra-nueva'), true);
});

test('POST /api/v1/operations/blocked-hosts añade un dominio y GET lo lista', async () => {
  const { db, dir } = tempDb();
  try {
    const repo = createBlockedHostsRepository(db);
    const app = buildBackend({ repository: repo, operationsApiKey: operationsToken });

    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/operations/blocked-hosts',
      headers: { authorization: `Bearer ${operationsToken}`, 'content-type': 'application/json' },
      payload: { domain: 'api-basura.test', reason: 'Dominio bloqueado vía API' },
    });
    assert.equal(post.statusCode, 201);
    assert.equal(post.json().domain, 'api-basura.test');

    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/blocked-hosts',
      headers: { authorization: `Bearer ${operationsToken}` },
    });
    assert.equal(get.statusCode, 200);
    const domains = get.json().domains;
    assert.ok(Array.isArray(domains));
    assert.ok(domains.some((row) => row.domain === 'api-basura.test' && row.reason === 'Dominio bloqueado vía API'));

    await app.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/v1/operations/blocked-hosts rechata dominios inválidos', async () => {
  const { db, dir } = tempDb();
  try {
    const repo = createBlockedHostsRepository(db);
    const app = buildBackend({ repository: repo, operationsApiKey: operationsToken });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/operations/blocked-hosts',
      headers: { authorization: `Bearer ${operationsToken}`, 'content-type': 'application/json' },
      payload: { domain: 'https://invalid.test/path', reason: 'malformed' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'invalid_domain');
    await app.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function createBlockedHostsRepository(db) {
  return {
    health: () => ({ database: 'ok' }),
    dashboard: () => ({ opportunities: [], sources: [], gestoras: [], cooperatives: [], events: [] }),
    opportunityById: () => null,
    gestoras: () => [],
    gestoraById: () => null,
    cooperatives: () => [],
    municipalityBySlug: () => null,
    seoRoutes: () => ({ municipalities: [], opportunities: [], gestoras: [] }),
    createRun: () => ({ id: 'run-1', mode: 'fast', status: 'queued' }),
    listRuns: () => [],
    runById: () => null,
    runByIdempotencyKey: () => null,
    activeRun: () => null,
    hasStagedCurationReviews: () => false,
    sources: () => [],
    curationCandidates: () => [],
    curationReviews: () => [],
    curationReviewById: () => null,
    opportunitiesWithoutPrice: () => [],
    stageCurationReview: () => ({}),
    diagnostics: () => ({ database: 'ok', opportunities: 0, sources: 0, gestoras: 0, cooperatives: 0 }),
    listBlockedHosts: () => listBlockedHosts(db),
    addBlockedHost: (domain, reason) => addBlockedHost(db, domain, reason),
  };
}
