import { getDatabase } from './lib/db.mjs';
import { resolveMunicipality } from './lib/municipios.mjs';
import { statusLabels } from './lib/statuses.mjs';
import { isGroundedEntityName } from './lib/llm.mjs';

const db = getDatabase({ readOnly: true });
const errors = [];
const warnings = [];

const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') errors.push(`SQLite integrity_check: ${integrity.integrity_check}`);

const fk = db.prepare('PRAGMA foreign_key_check').all();
if (fk.length) errors.push(`${fk.length} violaciones de claves foráneas`);

const badOpportunityLocations = db.prepare('SELECT id, title, location FROM opportunities').all()
  .filter((row) => !resolveMunicipality(row.location));
if (badOpportunityLocations.length) {
  errors.push(`${badOpportunityLocations.length} oportunidades fuera del ámbito o sin municipio canónico`);
}

const statuses = new Set(statusLabels());
const badStatuses = db.prepare("SELECT id, status FROM opportunities WHERE status IS NOT NULL AND status != ''").all()
  .filter((row) => !statuses.has(row.status));
if (badStatuses.length) errors.push(`${badStatuses.length} oportunidades con estado no canónico`);

const badPrices = db.prepare(`
  SELECT id, precioMin, precioMax FROM opportunities
  WHERE (precioMin IS NOT NULL AND (precioMin < 100000 OR precioMin > 2000000))
     OR (precioMax IS NOT NULL AND (precioMax < 100000 OR precioMax > 3000000))
     OR (precioMin IS NOT NULL AND precioMax IS NOT NULL AND precioMax < precioMin)
`).all();
if (badPrices.length) errors.push(`${badPrices.length} oportunidades con precios imposibles`);

const visiblePromotionsOutsideScope = db.prepare(`
  SELECT id FROM gestora_promotions
  WHERE scopeStatus = 'in_scope' AND (municipality IS NULL OR municipality = '')
`).all();
if (visiblePromotionsOutsideScope.length) errors.push(`${visiblePromotionsOutsideScope.length} promociones publicables sin municipio canónico`);

const scopeCounts = Object.fromEntries(
  db.prepare('SELECT scopeStatus, COUNT(*) n FROM gestora_promotions GROUP BY scopeStatus').all()
    .map((row) => [row.scopeStatus, row.n])
);

const normalizedName = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const promoGroups = new Map();
for (const row of db.prepare("SELECT id, gestoraId, name, municipality FROM gestora_promotions WHERE scopeStatus = 'in_scope'").all()) {
  const key = `${row.gestoraId}|${row.municipality}|${normalizedName(row.name)}`;
  const group = promoGroups.get(key) || [];
  group.push(row.id);
  promoGroups.set(key, group);
}
const exactPromoDuplicates = [...promoGroups.values()].filter((ids) => ids.length > 1);
if (exactPromoDuplicates.length) errors.push(`${exactPromoDuplicates.length} grupos de promociones exactamente duplicadas`);

const orphanAliases = db.prepare(`
  SELECT a.aliasId, a.canonicalId FROM entity_aliases a
  LEFT JOIN gestora_promotions p ON p.id = a.canonicalId
  WHERE a.entityKind = 'promotion'
    AND a.canonicalId != '__rejected__'
    AND p.id IS NULL
`).all();
if (orphanAliases.length) errors.push(`${orphanAliases.length} alias de promoción apuntan a entidades inexistentes`);

const orphanOpportunityLinks = db.prepare(`
  SELECT COUNT(*) n FROM opportunities o
  LEFT JOIN gestora_promotions p ON p.id = o.promotionId
  WHERE o.promotionId IS NOT NULL AND p.id IS NULL
`).get().n;
if (orphanOpportunityLinks) errors.push(`${orphanOpportunityLinks} oportunidades apuntan a promociones inexistentes`);

const orphanEvents = db.prepare(`SELECT COUNT(*) n FROM events e WHERE
  (e.entityKind = 'opportunity' AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = e.entityId)) OR
  (e.entityKind = 'promotion' AND NOT EXISTS (SELECT 1 FROM gestora_promotions p WHERE p.id = e.entityId)) OR
  (e.entityKind = 'cooperative' AND NOT EXISTS (SELECT 1 FROM cooperatives c WHERE c.cif = e.entityId AND c.active = 1))
`).get().n;
if (orphanEvents) errors.push(`${orphanEvents} eventos apuntan a entidades no publicables`);

const staleEvents = db.prepare(`SELECT COUNT(*) n FROM events e WHERE
  (e.kind = 'status' AND e.entityKind = 'opportunity' AND EXISTS (
    SELECT 1 FROM opportunities o WHERE o.id = e.entityId AND e.newValue IS NOT o.status
  )) OR
  (e.kind = 'status' AND e.entityKind = 'promotion' AND EXISTS (
    SELECT 1 FROM gestora_promotions p WHERE p.id = e.entityId AND e.newValue IS NOT p.status
  )) OR
  (e.kind = 'price' AND e.entityKind = 'opportunity' AND EXISTS (
    SELECT 1 FROM opportunities o WHERE o.id = e.entityId AND e.newValue IS NOT CAST(o.precioMin AS TEXT)
  ))
`).get().n;
if (staleEvents) errors.push(`${staleEvents} eventos contradicen el estado actual`);

const rejectedStillPresent = db.prepare(`
  SELECT COUNT(*) n FROM entity_aliases a
  JOIN gestora_promotions p ON p.id = a.aliasId
  WHERE a.entityKind = 'promotion' AND a.canonicalId = '__rejected__'
`).get().n;
if (rejectedStillPresent) errors.push(`${rejectedStillPresent} promociones rechazadas han reaparecido`);

const ungroundedFields = [];
for (const row of db.prepare(`
  SELECT id,title,summary,evidenceText,promotora,nombrePromocion,promotionId FROM opportunities
  WHERE promotionId IS NULL AND (promotora IS NOT NULL OR nombrePromocion IS NOT NULL)
`).all()) {
  const evidence = `${row.title || ''}\n${row.evidenceText || row.summary || ''}`;
  if (row.promotora && !isGroundedEntityName(row.promotora, evidence, 'company')) ungroundedFields.push(`${row.id}:promotora`);
  if (row.nombrePromocion && !isGroundedEntityName(row.nombrePromocion, evidence, 'promotion')) ungroundedFields.push(`${row.id}:nombrePromocion`);
}
if (ungroundedFields.length) errors.push(`${ungroundedFields.length} campos de entidad sin evidencia almacenada`);

const sources = db.prepare('SELECT name,kind,ok,checkedAt FROM sources').all();
const missingSourceRows = db.prepare(`SELECT COUNT(DISTINCT o.source) n FROM opportunities o LEFT JOIN sources s ON s.name=o.source WHERE s.name IS NULL`).get().n;
if (missingSourceRows) errors.push(`${missingSourceRows} fuentes de oportunidades sin trazabilidad en sources`);
const staleSources = sources.filter((source) => !source.checkedAt || Date.now() - Date.parse(source.checkedAt) > 30 * 60 * 60 * 1000);
if (staleSources.length) errors.push(`${staleSources.length} fuentes sin comprobación en las últimas 30 horas`);
const failedSources = sources.filter((source) => !source.ok);
if (failedSources.length > Math.max(1, Math.floor(sources.length / 2))) errors.push(`${failedSources.length}/${sources.length} fuentes fallan`);
else if (failedSources.length) warnings.push(`${failedSources.length}/${sources.length} fuentes fallan actualmente`);

const missing = db.prepare(`
  SELECT
    SUM(status IS NULL) noStatus,
    SUM(precioMin IS NULL) noPrice,
    SUM(promotora IS NULL) noPromotora,
    SUM(nombrePromocion IS NULL) noPromotionName
  FROM opportunities
`).get();
warnings.push(`${missing.noStatus || 0} oportunidades sin estado`);
warnings.push(`${missing.noPrice || 0} oportunidades sin precio`);
warnings.push(`${missing.noPromotora || 0} oportunidades sin promotora`);
warnings.push(`${missing.noPromotionName || 0} oportunidades sin nombre de promoción`);
warnings.push(`${scopeCounts.unverified || 0} promociones en cuarentena por ubicación no verificada`);
warnings.push(`${scopeCounts.out_of_scope || 0} promociones conservadas fuera del ámbito`);

console.log('=== VIVIENDA CORUÑA · QUALITY GATE ===');
console.log(`Oportunidades: ${db.prepare('SELECT COUNT(*) n FROM opportunities').get().n}`);
console.log(`Promociones publicables: ${scopeCounts.in_scope || 0}`);
console.log(`Cooperativas oficiales: ${db.prepare('SELECT COUNT(*) n FROM cooperatives WHERE active = 1').get().n}`);
for (const warning of warnings) console.log(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log('PASS: integridad, ámbito, estados, precios y duplicados exactos correctos');
}
