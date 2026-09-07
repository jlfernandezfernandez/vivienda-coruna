import assert from 'node:assert/strict';
import test from 'node:test';
import { hasOpenRecruitment, matchesHousing, searchGestoras, directoryFilters } from '../src/lib/housing-search.mjs';

test('a cooperative news signal or a sold project is not confirmed open recruitment', () => {
  assert.equal(hasOpenRecruitment({ type: 'Cooperativa', status: null }), false);
  assert.equal(hasOpenRecruitment({ buscaSocios: true, status: 'Agotada/Vendida' }), false);
  assert.equal(hasOpenRecruitment({ buscaSocios: true, status: 'Entregada' }), false);
  assert.equal(hasOpenRecruitment({ buscaSocios: true, status: 'En preventa' }), true);
});

test('search matches accents and words across project and gestora, in the project municipality', () => {
  const gestoras = [{ id: 'g1', name: 'Gestión Norte', address: 'Madrid', promotions: [
    { id: 'p1', name: 'Residencial Xuxán', municipality: 'A Coruña', precioMin: 210000 },
    { id: 'p2', name: 'Santa Cruz', municipality: 'Oleiros', precioMin: 320000 },
  ] }];
  const filters = directoryFilters(new URLSearchParams('q=norte+xuxan&municipality=A+Coruña&maxPrice=250000'));
  const result = searchGestoras(gestoras, filters);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].promotions.map(p => p.id), ['p1']);
  assert.equal(gestoras[0].promotions.length, 2, 'search must not mutate the API response');
  assert.equal(searchGestoras(gestoras, { ...filters, municipality: 'Madrid' }).length, 0);
});

test('budget keeps unknown prices visible and never treats the initial contribution as total price', () => {
  const filters = directoryFilters(new URLSearchParams('maxPrice=250000'));
  assert.equal(matchesHousing({ precioMin: 250000 }, filters), true);
  assert.equal(matchesHousing({ precioMin: 250001 }, filters), false);
  assert.equal(matchesHousing({ precioMin: null, aportacionInicial: 20000 }, filters), true);
});

test('closed projects and recruitment filters use actual evidence', () => {
  const filters = directoryFilters(new URLSearchParams('excludeClosed=1&recruiting=1'));
  assert.equal(matchesHousing({ buscaSocios: true, status: 'En preventa' }, filters), true);
  assert.equal(matchesHousing({ buscaSocios: null, status: 'En construcción' }, filters), false);
  assert.equal(matchesHousing({ buscaSocios: true, status: 'Entregada' }, filters), false);
});

test('directory filters handle invalid price and bounded query text', () => {
  for (const value of ['NaN', '-1', 'Infinity', '0', 'abc']) {
    assert.equal(directoryFilters(new URLSearchParams(`maxPrice=${value}`)).maxPrice, null);
  }
  assert.equal(directoryFilters(new URLSearchParams('q=' + 'a'.repeat(500))).q.length, 120);
});
