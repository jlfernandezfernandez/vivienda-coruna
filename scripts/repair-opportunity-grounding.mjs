import { getDatabase } from './lib/db.mjs';
import { validateExtractedHousingData } from './lib/llm.mjs';
import { normalizeGestoraId, slugify } from './lib/monitor.mjs';
import { requirePipelineWriter } from './lib/writer-lock.mjs';

requirePipelineWriter();
const db = getDatabase();
const rows = db.prepare('SELECT * FROM opportunities').all();
const promotionExists = db.prepare(`SELECT p.id, p.name, p.status, g.name AS gestoraName
  FROM gestora_promotions p JOIN gestoras g ON g.id = p.gestoraId WHERE p.id = ?`);
const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind='promotion' AND aliasId=?");
const updateLink = db.prepare('UPDATE opportunities SET promotionId = ? WHERE id = ?');
const updateGrounded = db.prepare(`
  UPDATE opportunities SET
    precioMin = ?, precioMax = ?, habitacionesMin = ?, banosMin = ?,
    promotora = ?, totalViviendas = ?, garaje = ?, trastero = ?, terraza = ?,
    status = ?, nombrePromocion = ?, enriched = ?
  WHERE id = ?
`);

// When re-grounding nullifies a field that a prior run recorded as a change
// event (price/status), the event becomes contradictory with the current
// state and blocks the quality gate. Remove those stale events in the same
// transaction so reconciliation and event history stay consistent.
const deleteStalePriceEvents = db.prepare(`
  DELETE FROM events
  WHERE entityKind = 'opportunity' AND entityId = ? AND kind = 'price'
    AND newValue IS NOT CAST((SELECT precioMin FROM opportunities WHERE id = ?) AS TEXT)
`);
const deleteStaleStatusEvents = db.prepare(`
  DELETE FROM events
  WHERE entityKind = 'opportunity' AND entityId = ? AND kind = 'status'
    AND newValue IS NOT (SELECT status FROM opportunities WHERE id = ?)
`);

let linked = 0;
let invalidated = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    let canonicalPromotion = row.promotionId ? promotionExists.get(row.promotionId) : null;
    if (!canonicalPromotion) {
      if (row.promotora && row.nombrePromocion) {
        const candidate = `promo:${normalizeGestoraId(row.promotora)}:${slugify(row.nombrePromocion)}`;
        const canonicalId = alias.get(candidate)?.canonicalId || candidate;
        if (canonicalId !== '__rejected__' && promotionExists.get(canonicalId)) {
          updateLink.run(canonicalId, row.id);
          canonicalPromotion = promotionExists.get(canonicalId);
          linked++;
        }
      }
    }

    const evidence = row.evidenceText || row.summary || '';
    const grounded = validateExtractedHousingData({
      precioMin: row.precioMin,
      precioMax: row.precioMax,
      habitacionesMin: row.habitacionesMin,
      banosMin: row.banosMin,
      promotora: row.promotora,
      totalViviendas: row.totalViviendas,
      garaje: row.garaje === 1 ? true : row.garaje === 0 ? false : null,
      trastero: row.trastero === 1 ? true : row.trastero === 0 ? false : null,
      terraza: row.terraza === 1 ? true : row.terraza === 0 ? false : null,
      estado: row.status,
      nombrePromocion: row.nombrePromocion,
    }, row.title || '', evidence);
    const validated = [
      grounded.precioMin, grounded.precioMax, grounded.habitacionesMin, grounded.banosMin,
      grounded.promotora, grounded.totalViviendas,
      grounded.garaje === true ? 1 : grounded.garaje === false ? 0 : null,
      grounded.trastero === true ? 1 : grounded.trastero === false ? 0 : null,
      grounded.terraza === true ? 1 : grounded.terraza === false ? 0 : null,
      grounded.estado, grounded.nombrePromocion,
    ];
    if (canonicalPromotion) {
      grounded.promotora = canonicalPromotion.gestoraName;
      grounded.nombrePromocion = canonicalPromotion.name;
      if (canonicalPromotion.status && canonicalPromotion.status !== 'Sin confirmar') grounded.estado = canonicalPromotion.status;
    }

    const next = [
      grounded.precioMin, grounded.precioMax, grounded.habitacionesMin, grounded.banosMin,
      grounded.promotora, grounded.totalViviendas,
      grounded.garaje === true ? 1 : grounded.garaje === false ? 0 : null,
      grounded.trastero === true ? 1 : grounded.trastero === false ? 0 : null,
      grounded.terraza === true ? 1 : grounded.terraza === false ? 0 : null,
      grounded.estado, grounded.nombrePromocion,
    ];
    const current = [
      row.precioMin, row.precioMax, row.habitacionesMin, row.banosMin,
      row.promotora, row.totalViviendas, row.garaje, row.trastero, row.terraza,
      row.status, row.nombrePromocion,
    ];
    const changed = next.some((value, index) => value !== current[index]);
    const requiresRetry = validated.some((value, index) => {
      if (canonicalPromotion && (index === 4 || index === 9 || index === 10)) return false;
      return value !== current[index];
    });
    if (changed) {
      updateGrounded.run(...next, requiresRetry ? 0 : row.enriched, row.id);
      // If re-grounding nullified a price/status that a prior run logged as a
      // change event, drop the now-contradictory event so the quality gate
      // (which fails on events whose newValue differs from current state)
      // does not block the pipeline. Only fire on nullification (the repair
      // re-validates against evidence and nullifies unsupported values); a
      // change to a new non-null value is not produced by this script, and
      // deleting on any change would discard legitimate event history.
      if (next[0] === null && current[0] !== null) deleteStalePriceEvents.run(row.id, row.id);
      if (next[9] === null && current[9] !== null) deleteStaleStatusEvents.run(row.id, row.id);
      invalidated++;
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Vinculadas ${linked} oportunidades a promociones canónicas; ${invalidated} oportunidades históricas limpiadas y marcadas para reintento.`);
