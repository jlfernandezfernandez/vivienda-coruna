import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { backfillGeocoding, ensureSchema } from '../scripts/lib/db.mjs';
import { MUNI_CENTROIDS, resolveGeoLocation } from '../scripts/lib/geocoder.mjs';

// Un barrio mencionado de pasada en el titular o en la evidencia no puede cambiar
// el municipio de la promoción cuando `location` ya lo declara.

test('resolveGeoLocation respeta el municipio conocido frente a un barrio de otro concello', () => {
  // "Santa Cruz" es un barrio de Oleiros: aparecía en noticias de Arteixo y las
  // etiquetaba como Oleiros.
  const arteixo = resolveGeoLocation(
    'Arteixo sumará obra nueva de lujo en régimen de cooperativa junto a Santa Cruz',
    'Arteixo'
  );
  assert.equal(arteixo?.municipality, 'Arteixo');
  assert.equal(arteixo?.lat, MUNI_CENTROIDS['Arteixo'].lat);

  const culleredo = resolveGeoLocation(
    'La Xunta licita 17 viviendas en Vilaboa: el alcalde compara la zona con Mera y Perillo',
    'Culleredo'
  );
  assert.equal(culleredo?.municipality, 'Culleredo');

  const carral = resolveGeoLocation('El suelo del polígono de Carral, como en Rabadeira', 'Carral');
  assert.equal(carral?.municipality, 'Carral');
});

test('resolveGeoLocation conserva la precisión cuando el barrio es del municipio esperado', () => {
  const perillo = resolveGeoLocation('Cooperativa de viviendas en Perillo, Oleiros', 'Oleiros');
  assert.equal(perillo?.municipality, 'Oleiros');
  assert.equal(perillo?.barrio, 'Perillo');
  assert.equal(perillo?.geoPrecision, 'barrio');

  const burgo = resolveGeoLocation('Obra nueva en O Burgo y una mención a Perillo', 'Culleredo');
  assert.equal(burgo?.municipality, 'Culleredo');
  assert.equal(burgo?.barrio, 'O Burgo');
});

test('resolveGeoLocation sin municipio conocido mantiene el comportamiento anterior', () => {
  const sinPista = resolveGeoLocation('Cooperativa de viviendas en Perillo, Oleiros');
  assert.equal(sinPista?.municipality, 'Oleiros');
  assert.equal(sinPista?.barrio, 'Perillo');
});

test('resolveGeoLocation cae al centro del municipio esperado si el texto no menciona nada suyo', () => {
  const geo = resolveGeoLocation('Promoción sin ubicación reconocible', 'Sada');
  assert.equal(geo?.municipality, 'Sada');
  assert.equal(geo?.geoPrecision, 'fallback');
});

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-geo-db-'));
  const db = new DatabaseSync(join(dir, 'geo.db'));
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  return { db, dir };
}

function insertOpportunity(db, row) {
  db.prepare(`
    INSERT INTO opportunities (id, title, url, source, sourceKind, firstSeenAt, lastSeenAt,
      location, municipality, lat, lng, barrio, geoPrecision, summary)
    VALUES (?, ?, ?, 'Prueba', 'test', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.title, `https://example.test/${row.id}`, row.location,
    row.municipality ?? null, row.lat ?? null, row.lng ?? null,
    row.barrio ?? null, row.geoPrecision ?? null, row.summary ?? null
  );
}

test('backfillGeocoding corrige un municipio que contradice a location', () => {
  const { db, dir } = createTempDb();
  try {
    insertOpportunity(db, {
      id: 'mal-etiquetada',
      title: 'VPG-2026-0085: contrato de obras para 17 viviendas en Vilaboa',
      location: 'Culleredo',
      municipality: 'A Coruña',
      lat: 43.3623,
      lng: -8.4115,
      summary: 'Promoción pública en Vilaboa, Culleredo.',
    });
    insertOpportunity(db, {
      id: 'correcta',
      title: 'Viviendas en Oleiros',
      location: 'Oleiros',
      municipality: 'Oleiros',
      lat: MUNI_CENTROIDS['Oleiros'].lat,
      lng: MUNI_CENTROIDS['Oleiros'].lng,
    });
    insertOpportunity(db, {
      id: 'sin-datos',
      title: 'Promoción en Sada',
      location: 'Sada',
    });

    backfillGeocoding(db);

    const corregida = db.prepare('SELECT municipality, lat, lng, barrio FROM opportunities WHERE id = ?').get('mal-etiquetada');
    assert.equal(corregida.municipality, 'Culleredo');
    // Vilaboa es un barrio de Culleredo, así que la corrección incluso gana precisión;
    // lo importante es que ya no apunta al centro de A Coruña.
    assert.notEqual(corregida.lat, 43.3623);
    assert.ok(corregida.lat > 43.28 && corregida.lat < 43.34, `lat fuera de Culleredo: ${corregida.lat}`);

    const intacta = db.prepare('SELECT municipality, lat, lng FROM opportunities WHERE id = ?').get('correcta');
    assert.equal(intacta.municipality, 'Oleiros');
    assert.equal(intacta.lat, MUNI_CENTROIDS['Oleiros'].lat);

    const rellenada = db.prepare('SELECT municipality, lat FROM opportunities WHERE id = ?').get('sin-datos');
    assert.equal(rellenada.municipality, 'Sada');
    assert.equal(rellenada.lat, MUNI_CENTROIDS['Sada'].lat);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
