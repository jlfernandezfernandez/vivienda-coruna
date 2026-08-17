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

test('coverage is built by backend from DTO municipality slugs and gestora promotions', () => {
  const coverage = createCoverageBuilder(sample)([
    {
      id: 'op-1', title: 'Residencial', municipalitySlug: 'a-coruna', type: 'Obra nueva', precioMin: 200000,
    },
  ], [
    {
      id: 'gestora-1',
      name: 'Gestora Test',
      promotions: [{
        id: 'pr-1',
        name: 'Promoción Test',
        municipalitySlug: 'a-coruna',
        buscaSocios: true,
        status: 'En comercialización',
        lat: 43.36,
        lng: -8.41,
      }],
    },
  ]);
  assert.equal(coverage.boundaries.length, 1);
  assert.equal(coverage.markers.length, 2);
  assert.equal(coverage.markers[0].url, '/oportunidad/op-1');
  assert.equal(coverage.markers[0].municipality, 'A Coruña');
  assert.equal(coverage.markers[1].url, '/gestora/gestora-1');
  assert.equal(coverage.markers[1].type, 'Cooperativa');
  assert.equal(coverage.markers[1].color, '#1f4d36');
});

test('runtime server uses a SQLite connection factory, performs backfill and requires operations auth', () => {
  const source = readFileSync(new URL('../backend/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /createRepository\(\s*\(\) => new DatabaseSync/);
  assert.match(source, /backfillGeocoding\(bootstrap\)/);
  assert.match(source, /OPERATIONS_API_KEY/);
  assert.match(source, /interruptRunningRuns/);
  assert.match(source, /drainRuns/);
});

