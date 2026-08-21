import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithRegex } from '../scripts/lib/regex-extractor.mjs';

test('extractWithRegex extrae precios, dormitorios, garaje, terraza y barrio sin LLM', () => {
  const text = `
    Residencial Mirador de Xuxán: 32 viviendas de 2 y 3 dormitorios en A Coruña.
    Precios desde 225.000 euros. Todas las viviendas incluyen garaje, trastero y terraza.
    Dispone de piscina comunitaria y ascensor. Entrega prevista en 2027.
  `;
  const result = extractWithRegex(text);

  assert.equal(result.precioMin, 225000);
  assert.equal(result.habitacionesMin, 2);
  assert.equal(result.totalViviendas, 32);
  assert.equal(result.garaje, true);
  assert.equal(result.trastero, true);
  assert.equal(result.terraza, true);
  assert.equal(result.piscina, true);
  assert.equal(result.ascensor, true);
  assert.equal(result.entregaEstimada, '2027');
  assert.equal(result.barrio, 'Xuxán');
  assert.equal(result.municipio, 'A Coruña');
  assert.equal(result.nombrePromocion, 'Residencial Mirador de Xuxán');
  assert.equal(result._llmNeeded, false);
});

test('extractWithRegex marca _llmNeeded: true cuando el texto carece de datos estructurados suficientes', () => {
  const text = 'Noticia breve sobre el sector inmobiliario en Galicia sin cifras concretas.';
  const result = extractWithRegex(text);
  assert.equal(result._llmNeeded, true);
});

test('extractWithRegex reconoce formulaciones contextualizadas de precio comercial', () => {
  const cases = [
    ['Los precios arrancan en 210.000 euros para las primeras viviendas.', 210000],
    ['La promoción está a la venta desde 225.000 €.', 225000],
    ['Cada vivienda se ofrece por 235.000 euros.', 235000],
    ['El precio de venta es de 245.000 euros.', 245000],
    ['Viviendas desde 255.000 euros más IVA.', 255000],
    ['El coste estará alrededor de 265.000 euros.', 265000],
    ['O prezo estará arredor de 275.000 euros.', 275000],
  ];

  for (const [text, expected] of cases) {
    assert.equal(extractWithRegex(text).precioMin, expected, text);
  }
});
