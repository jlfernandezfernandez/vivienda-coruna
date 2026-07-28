import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../src/lib/api/client.mjs';
import { applyApiFailure } from '../src/lib/api/boundary.mjs';

test('missing public resources become a real noindex 404 response', () => {
  const response = { status: 200, headers: new Headers() };

  const result = applyApiFailure(response, new ApiError('missing', { status: 404, kind: 'not_found' }));

  assert.equal(result, 'not_found');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  assert.equal(response.headers.get('retry-after'), null);
});

test('an unavailable backend becomes a noindex 503 response with Retry-After', () => {
  const response = { status: 200, headers: new Headers() };

  const result = applyApiFailure(response, new ApiError('down', { kind: 'unavailable' }));

  assert.equal(result, 'unavailable');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
});
