import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, createApiClient } from '../src/lib/api/client.mjs';

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('dashboard uses the versioned internal API and returns its complete contract', async () => {
  const requests = [];
  const client = createApiClient({
    baseUrl: 'http://backend.internal/',
    fetch: async (url) => {
      requests.push(String(url));
      return response(200, {
        opportunities: [], sources: [], gestoras: [], cooperatives: [], events: [],
        municipalities: [{ name: 'A Coruña', slug: 'a-coruna' }],
        coverage: { boundaries: [], markers: [] },
      });
    },
  });

  const dashboard = await client.dashboard();

  assert.equal(requests[0], 'http://backend.internal/api/v1/dashboard');
  assert.deepEqual(dashboard.coverage, { boundaries: [], markers: [] });
  assert.equal(dashboard.municipalities[0].slug, 'a-coruna');
});

test('GET retries one transient network failure before succeeding', async () => {
  let attempts = 0;
  const client = createApiClient({
    baseUrl: 'http://backend.internal',
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network unavailable');
      return response(200, { id: 'op-1', municipalitySlug: 'a-coruna', statusLabel: 'En preventa', statusTone: 'positive' });
    },
  });

  const opportunity = await client.opportunity('op-1');

  assert.equal(attempts, 2);
  assert.equal(opportunity.statusTone, 'positive');
});

test('GET retries one retryable gateway response before succeeding', async () => {
  let attempts = 0;
  const client = createApiClient({
    baseUrl: 'http://backend.internal',
    fetch: async () => {
      attempts += 1;
      return attempts === 1
        ? response(503, { error: 'unavailable' })
        : response(200, []);
    },
  });

  assert.deepEqual(await client.gestoras(), []);
  assert.equal(attempts, 2);
});

test('not found responses remain distinguishable from backend failures', async () => {
  const client = createApiClient({
    baseUrl: 'http://backend.internal',
    fetch: async () => response(404, { error: 'not_found' }),
  });

  await assert.rejects(client.municipality('missing'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.kind, 'not_found');
    return true;
  });
});

test('rejects malformed public payloads at the API boundary', async () => {
  const client = createApiClient({
    baseUrl: 'http://backend.internal',
    fetch: async () => response(200, { opportunities: [] }),
  });

  await assert.rejects(client.dashboard(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, 'invalid_contract');
    return true;
  });
});
