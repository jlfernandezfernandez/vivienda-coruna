import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createCoverageBuilder } from '../backend/coverage.mjs';

const sample = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: 'A Coruña' },
    geometry: { type: 'Polygon', coordinates: [[[-8.42, 43.35], [-8.40, 43.35], [-8.40, 43.37], [-8.42, 43.35]]] },
  }],
};

test('coverage is built by backend from DTO municipality slugs', () => {
  const coverage = createCoverageBuilder(sample)([{
    id: 'op-1', title: 'Residencial', municipalitySlug: 'a-coruna', type: 'Obra nueva', precioMin: 200000,
  }]);
  assert.equal(coverage.boundaries.length, 1);
  assert.equal(coverage.markers.length, 1);
  assert.equal(coverage.markers[0].url, '/oportunidad/op-1');
});

test('runtime server uses a SQLite connection factory and requires operations auth', () => {
  const source = readFileSync(new URL('../backend/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /createRepository\(\s*\(\) => new DatabaseSync/);
  assert.match(source, /OPERATIONS_API_KEY/);
  assert.match(source, /interruptRunningRuns/);
  assert.match(source, /drainRuns/);
});
