import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGeoLocation } from '../scripts/lib/geocoder.mjs';

test('resolveGeoLocation identifies street and parcel level precision in Xuxán & Visma', () => {
  const matilde = resolveGeoLocation('Promoción de 40 viviendas en Rúa Matilde Landa, Xuxán');
  assert.equal(matilde?.barrio, 'Xuxán');
  assert.equal(matilde?.geoPrecision, 'calle');
  assert.equal(matilde?.lat, 43.3418);

  const visma = resolveGeoLocation('Construcción de viviendas en Camiño do Pinar, Visma');
  assert.equal(visma?.barrio, 'San Pedro de Visma');
  assert.equal(visma?.geoPrecision, 'calle');
  assert.equal(visma?.lat, 43.3638);

  const galeras = resolveGeoLocation('Residencial exclusivo en As Galeras, Oleiros');
  assert.equal(galeras?.municipality, 'Oleiros');
  assert.equal(galeras?.geoPrecision, 'calle');
});
