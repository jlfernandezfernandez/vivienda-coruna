import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenJaccardSimilarity,
  normalizedStringSimilarity,
  calculateMatchScore,
  clusterAndFuseOpportunities
} from '../scripts/lib/dedup.mjs';

test('tokenJaccardSimilarity detects cross-press rewrites ignoring stopwords', () => {
  const t1 = 'Sorteo de 14 viviendas de VPP en Xuxán, A Coruña';
  const t2 = 'La Xunta publica el sorteo de 14 pisos protegidos en el barrio de Xuxán';
  const sim = tokenJaccardSimilarity(t1, t2);
  assert.ok(sim >= 0.40, `Expected >= 0.40, got ${sim}`);
});

test('calculateMatchScore detects match between press and official alert for same promotion', () => {
  const itemA = {
    id: '111',
    title: 'Sorteo de 14 viviendas de VPP en Xuxán',
    municipality: 'A Coruña',
    barrio: 'Xuxán',
    totalViviendas: 14,
    publishedAt: '2026-07-15T10:00:00Z',
    sourceKind: 'official'
  };

  const itemB = {
    id: '222',
    title: 'La Voz: Abierto el plazo para las 14 VPP en el barrio de Xuxán',
    municipality: 'A Coruña',
    barrio: 'Xuxán',
    totalViviendas: 14,
    publishedAt: '2026-07-16T12:00:00Z',
    sourceKind: 'market-alert'
  };

  const score = calculateMatchScore(itemA, itemB);
  assert.ok(score >= 0.85, `Expected >= 0.85, got ${score}`);
});

test('clusterAndFuseOpportunities combines multiple source citations into one entity', () => {
  const items = [
    {
      id: 'a',
      title: 'Mirador do Ézaro: 30 viviendas en Someso',
      nombrePromocion: 'Mirador do Ézaro',
      promotora: 'Gescomar',
      municipality: 'A Coruña',
      barrio: 'Someso',
      precioMin: 220000,
      url: 'https://lavozdegalicia.es/noticia1',
      source: 'Prensa · La Voz de Galicia',
      sourceKind: 'market-alert',
      publishedAt: '2026-07-10T00:00:00Z'
    },
    {
      id: 'b',
      title: 'Residencial Mirador do Ezaro Someso',
      nombrePromocion: 'Mirador do Ézaro',
      promotora: 'Gescomar',
      municipality: 'A Coruña',
      barrio: 'Someso',
      precioMin: 215000,
      url: 'https://laopinioncoruna.es/noticia2',
      source: 'Prensa · La Opinión',
      sourceKind: 'market-alert',
      publishedAt: '2026-07-11T00:00:00Z'
    },
    {
      id: 'c',
      title: 'Obra nueva en Perillo Oleiros',
      nombrePromocion: 'Galeras Park',
      municipality: 'Oleiros',
      barrio: 'Perillo',
      precioMin: 310000,
      url: 'https://elidealgallego.com/noticia3',
      source: 'Prensa · El Ideal Gallego',
      sourceKind: 'market-alert',
      publishedAt: '2026-07-12T00:00:00Z'
    }
  ];

  const fused = clusterAndFuseOpportunities(items);
  assert.equal(fused.length, 2, 'Should cluster items a and b into 1');

  const ezaro = fused.find(f => f.nombrePromocion === 'Mirador do Ézaro');
  assert.ok(ezaro);
  assert.equal(ezaro.sourcesCount, 2);
  assert.equal(ezaro.citations.length, 2);
  assert.equal(ezaro.precioMin, 215000, 'Takes lowest min price');
});
