import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackend } from '../backend/app.mjs';

function fakeRepository() {
  return {
    health: () => ({ database: 'ok' }),
    dashboard: () => ({ opportunities: [{ id: 'op-1', title: 'Residencial Test' }], sources: [], gestoras: [], cooperatives: [], events: [] }),
    opportunityById: (id) => (id === 'op-1' ? { id, title: 'Residencial Test' } : null),
  };
}

test('GET /health exposes process health without operational secrets', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-secret' });
  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  await app.close();
});

test('GET /api/v1/dashboard exposes public monitor data', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-secret' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().opportunities[0].id, 'op-1');
  await app.close();
});

test('GET /api/v1/opportunities/:id returns 404 for an unknown opportunity', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-secret' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/opportunities/missing' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'not_found' });
  await app.close();
});

test('operational endpoints reject requests without the configured bearer token', async () => {
  const app = buildBackend({ repository: fakeRepository(), operationsApiKey: 'test-secret' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/operations/diagnostics' });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
  await app.close();
});
