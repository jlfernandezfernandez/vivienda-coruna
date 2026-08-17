import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGeoLocation, MUNI_CENTROIDS } from '../scripts/lib/geocoder.mjs';

test('resolveGeoLocation extrae coordenadas de barrios específicos con precisión barrio', () => {
  const xuxan = resolveGeoLocation('Promoción de 40 viviendas de VPP en Xuxán, A Coruña');
  assert.equal(xuxan?.barrio, 'Xuxán');
  assert.equal(xuxan?.municipality, 'A Coruña');
  assert.equal(xuxan?.geoPrecision, 'barrio');
  assert.equal(xuxan?.lat, 43.3415);
  assert.equal(xuxan?.lng, -8.4042);

  const someso = resolveGeoLocation('Residencial Someso Towers junto al Coliseum');
  assert.equal(someso?.barrio, 'Someso');
  assert.equal(someso?.municipality, 'A Coruña');

  const visma = resolveGeoLocation('Nuevo polígono residencial en San Pedro de Visma');
  assert.equal(visma?.barrio, 'San Pedro de Visma');
  assert.equal(visma?.municipality, 'A Coruña');

  const perillo = resolveGeoLocation('Cooperativa de viviendas en Perillo, Oleiros');
  assert.equal(perillo?.barrio, 'Perillo');
  assert.equal(perillo?.municipality, 'Oleiros');

  const burgo = resolveGeoLocation('Obra nueva residencial en O Burgo, Culleredo');
  assert.equal(burgo?.barrio, 'O Burgo');
  assert.equal(burgo?.municipality, 'Culleredo');
});

test('resolveGeoLocation resuelve centro de municipio cuando no hay barrio específico', () => {
  const oleiros = resolveGeoLocation('Viviendas unifamiliares en Oleiros');
  assert.equal(oleiros?.municipality, 'Oleiros');
  assert.equal(oleiros?.barrio, null);
  assert.equal(oleiros?.geoPrecision, 'municipio');
  assert.equal(oleiros?.lat, MUNI_CENTROIDS['Oleiros'].lat);
  assert.equal(oleiros?.lng, MUNI_CENTROIDS['Oleiros'].lng);

  const arteixo = resolveGeoLocation('Nueva cooperativa en Arteixo');
  assert.equal(arteixo?.municipality, 'Arteixo');
  assert.equal(arteixo?.lat, MUNI_CENTROIDS['Arteixo'].lat);
});

test('resolveGeoLocation usa fallback de municipio si el texto no contiene ubicación', () => {
  const fallback = resolveGeoLocation('Proyecto residencial sin nombre de calle', 'Cambre');
  assert.equal(fallback?.municipality, 'Cambre');
  assert.equal(fallback?.geoPrecision, 'fallback');
  assert.equal(fallback?.lat, MUNI_CENTROIDS['Cambre'].lat);
});
