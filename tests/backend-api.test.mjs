import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackend } from '../backend/app.mjs';

function fakeRepository() {
  return {
    health: () => ({ database: 'ok' }),
    dashboard: () => ({ opportunities: [{ id: 'op-1', title: 'Residencial Test' }], sources: [], gestoras: [], cooperatives: [], events: [] }),
    opportunityById: (id) => (id === 'op-1' ? { id, title: 'Residencial Test' } : null),
    gestoras: () => [{ id: 'g1', name: 'Gestora Uno', logo: '', website: '', phone: '', email: '', address: '', description: '', promotions: [] }],
    gestoraById: (id) => (id === 'g1' ? { id: 'g1', name: 'Gestora Uno', logo: '', website: '', phone: '', email: '', address: '', description: '', promotions: [] } : null),
    cooperatives: () => [{ cif: 'CIF1', name: 'Coop Uno', municipality: 'A Coruña' }],
    municipalityBySlug: (slug) => (slug === 'a-coruna' ? { slug: 'a-coruna', name: 'A Coruña', opportunities: [], gestoraPromotions: [], cooperatives: [] } : null),
    seoRoutes: () => ({ municipalities: ['/municipio/a-coruna'], opportunities: ['/oportunidad/op-1'], gestoras: ['/gestora/g1'] }),
    createRun: (mode, idempotencyKey) => ({ id: 'run-1', mode, idempotencyKey, status: 'queued', createdAt: new Date().toISOString() }),
    listRuns: () => [{ id: 'run-1', mode: 'fast', status: 'succeeded', createdAt: new Date().toISOString() }],
    runById: (id) => (id === 'run-1' ? { id: 'run-1', mode: 'fast', status: 'succeeded', createdAt: new Date().toISOString() } : null),
    sources: () => [{ name: 'src1', url: 'https://example.com', kind: 'rss', ok: true, scanned: 10, checkedAt: new Date().toISOString() }],
    diagnostics: () => ({ database: 'ok', opportunities: 42 }),
  };
}

test('GET /health exposes process health without operational secrets', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key', appVersion: 'sha-test' });
  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', version: 'sha-test' });
  await app.close();
});

test('GET /ready returns 200 when repository is healthy', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/ready' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ready');
  await app.close();
});

test('GET /ready returns 503 when repository throws', async () => {
  const brokenRepo = { ...fakeRepository(), health: () => { throw new Error('db down'); } };
  const app = buildBackend({ repository: brokenRepo, operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/ready' });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'unavailable' });
  await app.close();
});

test('GET /api/v1/dashboard exposes public monitor data', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().opportunities[0].id, 'op-1');
  await app.close();
});

test('GET /api/v1/opportunities/:id returns 404 for an unknown opportunity', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/missing' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'not_found' });
  await app.close();
});

test('GET /api/v1/opportunities/:id returns opportunity when found', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/op-1' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, 'op-1');
  await app.close();
});

test('GET /gestoras returns all gestoras with promotions', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/gestoras' });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 'g1');
  assert.equal(body[0].name, 'Gestora Uno');
  await app.close();
});

test('GET /gestoras/:id returns 404 for unknown gestora', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/gestoras/missing' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'not_found' });
  await app.close();
});

test('GET /gestoras/:id returns gestora when found', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/gestoras/g1' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, 'g1');
  await app.close();
});

test('GET /cooperatives returns all active cooperatives', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/cooperatives' });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].cif, 'CIF1');
  await app.close();
});

test('GET /municipalities/:slug returns 404 for unknown municipality', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/municipalities/unknown' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'not_found' });
  await app.close();
});

test('GET /municipalities/:slug returns municipality data when found', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/municipalities/a-coruna' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().slug, 'a-coruna');
  await app.close();
});

test('GET /seo/routes returns SEO-relevant route map', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/seo/routes' });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(Array.isArray(body.municipalities));
  assert.ok(Array.isArray(body.opportunities));
  assert.ok(Array.isArray(body.gestoras));
  await app.close();
});

test('operational endpoints reject requests without the configured bearer token', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/operations/diagnostics' });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
  await app.close();
});

test('operational endpoints accept requests with correct bearer token', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/diagnostics',
    headers: { authorization: 'Bearer test-key' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');
  await app.close();
});

test('POST /api/v1/operations/runs creates a run, dispatches it and returns 202 with Location', async () => {
  let dispatched = null;
  const app = buildBackend({
    repository: fakeRepository(),
    operationsApiKey: 'test-key',
    onRunCreated: (run) => { dispatched = run; },
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/operations/runs',
    headers: {
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
      'idempotency-key': 'test-run-fast',
    },
    payload: { mode: 'fast' },
  });

  assert.equal(response.statusCode, 202);
  assert.ok(response.headers.location);
  assert.ok(response.headers.location.startsWith('/api/v1/operations/runs/'));
  const body = response.json();
  assert.equal(body.status, 'queued');
  assert.equal(body.mode, 'fast');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dispatched.id, body.id);
  await app.close();
});

test('POST /api/v1/operations/runs rejects invalid mode', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/operations/runs',
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json', 'idempotency-key': 'test-run-invalid' },
    payload: { mode: 'invalid' },
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test('POST /api/v1/operations/runs requires an idempotency key', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/operations/runs',
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    payload: { mode: 'fast' },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'idempotency_key_required' });
  await app.close();
});

test('POST /api/v1/operations/runs respects idempotency key', async () => {
  const repo = fakeRepository();
  let callCount = 0;
  repo.createRun = (mode, idempotencyKey) => {
    callCount++;
    return { id: 'run-idem-1', mode, idempotencyKey, status: 'queued', createdAt: new Date().toISOString() };
  };
  const app = buildBackend({ repository: repo, operationsApiKey: 'test-key' });

  const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json', 'idempotency-key': 'key-abc-1' };
  const r1 = await app.inject({ method: 'POST', url: '/api/v1/operations/runs', headers, payload: { mode: 'fast' } });
  const r2 = await app.inject({ method: 'POST', url: '/api/v1/operations/runs', headers, payload: { mode: 'fast' } });

  assert.equal(r1.statusCode, 202);
  assert.equal(r2.statusCode, 202);
  assert.equal(r1.json().id, r2.json().id);
  await app.close();
});

test('GET /api/v1/operations/runs lists all runs', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/runs',
    headers: { authorization: 'Bearer test-key' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 'run-1');
  await app.close();
});

test('GET /api/v1/operations/runs/:id returns 404 for unknown run', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/runs/missing',
    headers: { authorization: 'Bearer test-key' },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'not_found' });
  await app.close();
});

test('GET /api/v1/operations/runs/:id returns run when found', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/runs/run-1',
    headers: { authorization: 'Bearer test-key' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, 'run-1');
  await app.close();
});

test('GET /api/v1/operations/sources returns all sources', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-key' });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/sources',
    headers: { authorization: 'Bearer test-key' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].name, 'src1');
  await app.close();
});
