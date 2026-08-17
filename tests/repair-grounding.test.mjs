import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { DatabaseSync } from 'node:sqlite';
import { ensureSchema } from '../scripts/lib/db.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const repairScript = join(projectRoot, 'scripts', 'repair-opportunity-grounding.mjs');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivienda-repair-'));
  const path = join(dir, 'monitor.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  return { dir, path, db };
}

function insertOpportunity(db, row) {
  db.prepare(`INSERT INTO opportunities (
    id,title,url,source,sourceKind,publishedAt,firstSeenAt,lastSeenAt,location,type,
    status,summary,precioMin,precioMax,habitacionesMin,banosMin,promotora,totalViviendas,
    garaje,trastero,terraza,enriched,nombrePromocion,promotionId,evidenceText,extractionMethod
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.title, row.url, row.source, row.sourceKind, row.publishedAt,
    row.firstSeenAt, row.lastSeenAt, row.location, row.type, row.status, row.summary,
    row.precioMin, row.precioMax, row.habitacionesMin, row.banosMin, row.promotora,
    row.totalViviendas, row.garaje, row.trastero, row.terraza, row.enriched,
    row.nombrePromocion, row.promotionId, row.evidenceText, row.extractionMethod,
  );
}

function runRepair(dbPath) {
  const env = { ...process.env, DB_PATH: dbPath, VIVIENDA_PIPELINE_LOCKED: '1' };
  return spawnSync(process.execPath, [repairScript], { cwd: projectRoot, env, encoding: 'utf8' });
}

test('repair-opportunity-grounding conserva totalViviendas sustentado en el cuerpo (prensa)', () => {
  const { dir, path, db } = tempDb();
  try {
    insertOpportunity(db, {
      id: 'opp-press-body',
      title: 'Oleiros abre el plazo para apuntarse a la cooperativa de la promoción Xardíns da Rabadeira',
      url: 'https://www.laopinioncoruna.es/gran-coruna/2026/06/03/oleiros-cooperativa-vivienda-proteccion-oficial-xardins-rabadeira-130985832.html',
      source: 'Firecrawl · Oleiros',
      sourceKind: 'firecrawl-search',
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-07-28T08:09:10.284Z',
      lastSeenAt: '2026-08-17T07:04:16.237Z',
      location: 'Oleiros',
      type: 'Cooperativa',
      status: 'Suelo/Proyecto',
      summary: null,
      precioMin: null, precioMax: null, habitacionesMin: 2, banosMin: null,
      promotora: 'GESTOGAR', totalViviendas: 26, garaje: 1, trastero: 1, terraza: 1,
      enriched: 1, nombrePromocion: 'Xardíns da Rabadeira',
      promotionId: 'promo:gestogar:xard-ns-da-rabadeira',
      evidenceText: 'Oleiros abre el plazo para apuntarse a la cooperativa de la promoción Xardíns da Rabadeira. Las viviendas, de 2 y 3 dormitorios, con terraza, trastero y plaza de garaje, saldrán a la venta con los precios oficiales marcados por la Xunta. Sobre ellas se levantarán en total 26 viviendas, 20 de protección y 6 a precio libre.',
      extractionMethod: 'hermes-curator',
    });
    db.close();

    const run = runRepair(path);
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);

    const check = new DatabaseSync(path, { readOnly: true });
    const row = check.prepare('SELECT totalViviendas FROM opportunities WHERE id = ?').get('opp-press-body');
    check.close();
    assert.equal(row.totalViviendas, 26, 'totalViviendas grounded in the body must survive the press-host re-validation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repair-opportunity-grounding anula totalViviendas no sustentado en título ni cuerpo (prensa)', () => {
  const { dir, path, db } = tempDb();
  try {
    insertOpportunity(db, {
      id: 'opp-press-ungrounded',
      title: 'Una promoción cualquiera en Oleiros',
      url: 'https://www.laopinioncoruna.es/gran-coruna/2026/06/03/ejemplo-123.html',
      source: 'Firecrawl · Oleiros',
      sourceKind: 'firecrawl-search',
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-07-28T08:09:10.284Z',
      lastSeenAt: '2026-08-17T07:04:16.237Z',
      location: 'Oleiros',
      type: 'Promoción nueva',
      status: null,
      summary: null,
      precioMin: null, precioMax: null, habitacionesMin: null, banosMin: null,
      promotora: null, totalViviendas: 26, garaje: null, trastero: null, terraza: null,
      enriched: 1, nombrePromocion: null, promotionId: null,
      evidenceText: 'Texto sin ninguna cifra de viviendas.',
      extractionMethod: 'hermes-curator',
    });
    db.close();

    const run = runRepair(path);
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);

    const check = new DatabaseSync(path, { readOnly: true });
    const row = check.prepare('SELECT totalViviendas FROM opportunities WHERE id = ?').get('opp-press-ungrounded');
    check.close();
    assert.equal(row.totalViviendas, null, 'ungrounded totalViviendas must be nullified');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
