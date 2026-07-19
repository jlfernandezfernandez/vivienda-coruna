import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLocation,
  detectStatus,
  isRelevantTitle,
  normalizeUrl,
  toOpportunity,
} from '../scripts/lib/monitor.mjs';

test('acepta únicamente A Coruña ciudad y su entorno inmediato', () => {
  const valid = [
    ['Construcción de 40 VPP en el municipio de A Coruña', 'A Coruña'],
    ['Parcela residencial para vivienda protegida en Arteixo', 'Arteixo'],
    ['Cooperativa de vivendas en Perillo', 'Perillo'],
    ['Promoción pública de vivienda en O Burgo', 'O Burgo'],
    ['VPP no Concello de Oleiros', 'Oleiros'],
  ];

  for (const [title, location] of valid) {
    assert.equal(isRelevantTitle(title), true, title);
    assert.equal(detectLocation(title), location);
  }
});

test('no confunde la provincia de A Coruña con la ciudad', () => {
  const invalid = [
    '58 VPP en O Bertón-Ferrol (A Coruña)',
    'Vivendas protexidas en Santiago de Compostela (A Coruña)',
    'VPP en Vigo (Pontevedra)',
    'Compra de vehículos híbridos en Arteixo',
  ];

  for (const title of invalid) assert.equal(isRelevantTitle(title), false, title);
});

test('normaliza enlaces y extrae estado', () => {
  assert.equal(
    normalizeUrl('https://www.contratosdegalicia.gal//licitacion?N=123'),
    'https://www.contratosdegalicia.gal/licitacion?N=123',
  );
  assert.equal(detectStatus('Estado: En curso Órgano de contratación: IGVS'), 'En curso');
});

test('convierte un item RSS al esquema público', () => {
  const result = toOpportunity(
    {
      title: 'Obras para 20 vivendas de promoción pública en Perillo',
      link: 'https://example.com//expediente/20',
      pubDate: '2026-07-19T09:00:00Z',
      contentSnippet: 'Estado: En curso Órgano de contratación: IGVS',
    },
    'CPG · IGVS',
    '2026-07-20T09:00:00.000Z',
  );

  assert.equal(result.location, 'Perillo');
  assert.equal(result.type, 'Vivienda protegida');
  assert.equal(result.status, 'En curso');
  assert.equal(result.url, 'https://example.com/expediente/20');
});
