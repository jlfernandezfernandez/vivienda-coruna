#!/usr/bin/env node
// Backfill de precios: aplica el extractor actualizado a oportunidades sin precio.
// Uso: DB_PATH=/ruta/monitor.db node scripts/backfill-prices.mjs
import { DatabaseSync } from 'node:sqlite';
import { extractWithRegex } from './lib/regex-extractor.mjs';
import { EXTRACTOR_VERSION } from './lib/extraction-policy.mjs';

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  console.error('DB_PATH required');
  process.exit(64);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

const rows = db.prepare(
  `SELECT id, title, summary, evidenceText, url FROM opportunities
   WHERE (precioMin IS NULL OR precioMin = '')`
).all();

let updated = 0;
for (const row of rows) {
  const text = [row.title, row.summary, row.evidenceText].filter(Boolean).join('\n');
  const extracted = extractWithRegex(text);
  if (extracted.precioMin) {
    // Propagar el precio a TODAS las filas con el mismo promotionId, para que la
    // deduplicación de la API elija una fila canónica que sí tenga precio.
    const promo = db.prepare('SELECT promotionId FROM opportunities WHERE id = ?').get(row.id);
    if (promo?.promotionId) {
      db.prepare(
        `UPDATE opportunities SET precioMin = ?, precioMax = ?, extractorVersion = ?
         WHERE promotionId = ?`
      ).run(extracted.precioMin, extracted.precioMax || null, EXTRACTOR_VERSION, promo.promotionId);
      console.log(`  [backfill] ${row.title.slice(0, 45)} -> ${extracted.precioMin}€ (propagado a ${promo.promotionId})`);
    } else {
      db.prepare(
        `UPDATE opportunities SET precioMin = ?, precioMax = ?, extractorVersion = ?
         WHERE id = ?`
      ).run(extracted.precioMin, extracted.precioMax || null, EXTRACTOR_VERSION, row.id);
      console.log(`  [backfill] ${row.title.slice(0, 45)} -> ${extracted.precioMin}€`);
    }
    updated++;
  }
}

console.log(`\n[backfill] ${updated} oportunidades actualizadas con precio.`);
db.close();
