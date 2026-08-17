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
      invalidated++;
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Vinculadas ${linked} oportunidades a promociones canónicas; ${invalidated} oportunidades históricas limpiadas y marcadas para reintento.`);
