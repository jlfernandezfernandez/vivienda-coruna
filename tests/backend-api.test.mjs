import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackend } from '../backend/app.mjs';

const operationsToken = ['test', 'token'].join('-');

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
    runByIdempotencyKey: () => null,
    activeRun: () => null,
    hasStagedCurationReviews: () => false,
    sources: () => [{ name: 'src1', url: 'https://example.com', kind: 'rss', ok: true, scanned: 10, checkedAt: new Date().toISOString() }],
    curationCandidates: () => [{ entityKind: 'opportunity', entityId: 'op-1', contentHash: 'a'.repeat(64), record: { id: 'op-1' } }],
    curationReviews: () => [{ id: 'review-1', status: 'staged' }],
    curationReviewById: (id) => (id === 'review-1' ? { id, status: 'staged', patch: { precioMin: 210000 } } : null),
    opportunitiesWithoutPrice: () => [{ entityKind: 'opportunity', entityId: 'op-2', contentHash: 'b'.repeat(64), record: { id: 'op-2', title: 'Residencial sin precio', precioMin: null, precioMax: null } }],
    stageCurationReview: (review) => ({ id: 'review-1', status: 'staged', ...review }),
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

test('curation API lists candidates and stages evidence-backed reviews', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: operationsToken });
  const headers = { authorization: `Bearer ${operationsToken}` };
  const candidates = await app.inject({ method: 'GET', url: '/api/v1/operations/curation/candidates', headers });
  assert.equal(candidates.statusCode, 200);
  assert.equal(candidates.json().candidates[0].entityId, 'op-1');

  const staged = await app.inject({
    method: 'POST',
    url: '/api/v1/operations/curation/reviews',
    headers,
    payload: {
      entityKind: 'opportunity', entityId: 'op-1', action: 'confirm',
      contentHash: 'a'.repeat(64), patch: {},
      evidence: [{
        url: 'https://example.com', excerpt: 'Dato verificado en la fuente.',
        screenshot: { ref: 'vivienda-curation/tests/api.png', sha256: '0'.repeat(64), capturedAt: new Date().toISOString() },
      }],
    },
  });
  assert.equal(staged.statusCode, 201);
  assert.equal(staged.json().status, 'staged');
  await app.close();
});

test('curation API maps stale candidate reviews to HTTP 409', async () => {
  const repository = { ...fakeRepository(), stageCurationReview: () => { throw new Error('stale_content'); } };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/curation/reviews',
    headers: { authorization: `Bearer ${operationsToken}` },
    payload: {
      entityKind: 'opportunity', entityId: 'op-1', action: 'confirm',
      contentHash: 'a'.repeat(64), patch: {},
      evidence: [{
        url: 'https://example.com', excerpt: 'Dato válido.',
        screenshot: { ref: 'vivienda-curation/tests/api.png', sha256: '0'.repeat(64), capturedAt: new Date().toISOString() },
      }],
    },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'stale_content' });
  await app.close();
});

test('curation API rejects staging while a pipeline snapshot may be in flight', async () => {
  const repository = { ...fakeRepository(), activeRun: () => ({ id: 'run-active', status: 'running' }) };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/curation/reviews',
    headers: { authorization: `Bearer ${operationsToken}` },
    payload: { entityKind: 'opportunity', entityId: 'op-1', action: 'confirm', contentHash: 'a'.repeat(64), patch: {}, evidence: [{ url: 'https://example.com', excerpt: 'Dato válido.' }] },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'operation_in_progress' });
  await app.close();
});

test('normal pipelines cannot start while curation reviews are staged', async () => {
  const repository = { ...fakeRepository(), hasStagedCurationReviews: () => true };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/runs',
    headers: { authorization: `Bearer ${operationsToken}`, 'idempotency-key': 'deep-during-curation' },
    payload: { mode: 'deep' },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'curation_in_progress' });
  await app.close();
});

test('curate run requires every candidate staged and then dispatches normally', async () => {
  const repository = {
    ...fakeRepository(),
    curationCandidates: () => [],
    hasStagedCurationReviews: () => true,
  };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/runs',
    headers: { authorization: `Bearer ${operationsToken}`, 'idempotency-key': 'curate-complete-batch' },
    payload: { mode: 'curate' },
  });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().mode, 'curate');
  await app.close();
});

test('idempotency keys cannot be reused across pipeline modes', async () => {
  const repository = {
    ...fakeRepository(),
    runByIdempotencyKey: () => ({ id: 'run-deep', mode: 'deep', status: 'succeeded' }),
  };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/runs',
    headers: { authorization: `Bearer ${operationsToken}`, 'idempotency-key': 'same-key-week-2026-31' },
    payload: { mode: 'curate' },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'idempotency_key_mode_mismatch' });
  await app.close();
});

test('a second run cannot be queued while another run is active', async () => {
  const repository = {
    ...fakeRepository(),
    activeRun: () => ({ id: 'run-active', mode: 'curate', status: 'queued' }),
  };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/runs',
    headers: { authorization: `Bearer ${operationsToken}`, 'idempotency-key': 'different-curate-key' },
    payload: { mode: 'curate' },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'operation_in_progress', runId: 'run-active' });
  await app.close();
});

test('curation API maps all known validation errors to 400', async () => {
  let validationError = 'required_field_missing:name';
  const repository = {
    ...fakeRepository(),
    stageCurationReview: () => { throw new Error(validationError); },
  };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  for (const expected of ['required_field_missing', 'invalid_notes', 'screenshot_required', 'invalid_screenshot_evidence']) {
    validationError = expected === 'required_field_missing' ? `${expected}:name` : expected;
    const response = await app.inject({
      method: 'POST', url: '/api/v1/operations/curation/reviews',
      headers: { authorization: `Bearer ${operationsToken}` }, body: {},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, expected);
  }
  await app.close();
});

test('curation API masks unexpected repository errors', async () => {
  const repository = {
    ...fakeRepository(),
    stageCurationReview: () => { throw new Error('SQLITE_CONSTRAINT: secret schema detail'); },
  };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/curation/reviews',
    headers: { authorization: `Bearer ${operationsToken}` },
    payload: { entityKind: 'opportunity' },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'internal_error' });
  await app.close();
});

test('curation API returns one review by id and 404 for an unknown review', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: operationsToken });
  const headers = { authorization: `Bearer ${operationsToken}` };

  const found = await app.inject({
    method: 'GET', url: '/api/v1/operations/curation/reviews/review-1', headers,
  });
  assert.equal(found.statusCode, 200);
  assert.equal(found.json().id, 'review-1');
  assert.deepEqual(found.json().patch, { precioMin: 210000 });

  const missing = await app.inject({
    method: 'GET', url: '/api/v1/operations/curation/reviews/missing', headers,
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: 'not_found' });
  await app.close();
});

test('curation API lists opportunities with an incomplete price range', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/curation/opportunities-without-price',
    headers: { authorization: `Bearer ${operationsToken}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().opportunities[0].entityId, 'op-2');
  assert.match(response.json().opportunities[0].contentHash, /^[a-f0-9]{64}$/);
  await app.close();
});

test('curation write endpoint rejects requests without OPERATIONS_API_KEY bearer auth', async () => {
  let writes = 0;
  const repository = {
    ...fakeRepository(),
    stageCurationReview: () => { writes += 1; return { id: 'unexpected' }; },
  };
  const app = buildBackend({ repository, operationsApiKey: operationsToken });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/operations/curation/reviews', payload: {},
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
  assert.equal(writes, 0);
  await app.close();
});
