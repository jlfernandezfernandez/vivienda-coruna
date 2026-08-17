import { getDatabase, reclassifyPromotionScopes } from './lib/db.mjs';
import { extractPublishedAt } from './lib/monitor.mjs';
import { requirePipelineWriter } from './lib/writer-lock.mjs';

requirePipelineWriter();
const db = getDatabase();
const now = new Date().toISOString();

const aliases = [
  // Mismo proyecto y dirección, variantes extraídas de portada/página de detalle.
  ['promo:amma-promocion:av-arteixo-123', 'promo:amma-promocion:avenida-de-arteixo-123', 'Misma dirección oficial: Avenida de Arteixo 123'],
  ['promo:amma-promocion:promoci-n-avenida-de-arteixo-123', 'promo:amma-promocion:avenida-de-arteixo-123', 'Misma dirección oficial: Avenida de Arteixo 123'],
  ['promo:amma-promocion:avenida-de-arteixo', 'promo:amma-promocion:avenida-de-arteixo-123', 'La ficha oficial vigente identifica la promoción como Avenida de Arteixo 123'],
  ['promo:amma-promocion:edificio-de-5-viviendas', 'promo:amma-promocion:plaza-de-vigo', 'La ficha oficial de Plaza de Vigo confirma que es el edificio de 5 viviendas'],
  ['promo:amma-promocion:pastoriza', 'promo:amma-promocion:promoci-n-de-obra-nueva-en-pastoriza', 'Misma promoción oficial en Pastoriza'],
  ['promo:masar:avda-finisterre-20', 'promo:masar:finisterre-20', 'Mismo edificio oficial: Avda. Finisterre 20'],
  ['promo:masar:ramon-y-cajal', 'promo:masar:ram-n-y-cajal-24-26-av-de-oza-24', 'Misma promoción de Ramón y Cajal / Avenida de Oza'],
  ['promo:metrovacesa:metrovacesa-obtiene-licencia-para-construir-un-residencial-de-100-viviendas-en-s', 'promo:metrovacesa:residencial-caleida', 'La licencia de 100 viviendas corresponde a Residencial Caleida'],
  ['promo:galivivienda:parcela-27', 'promo:galivivienda:alquiler50-parcela-27-90-viviendas', 'Misma parcela 27 de Alquiler50'],
  ['promo:galivivienda:parcela-35', 'promo:galivivienda:alquiler50-parcela-35-60-viviendas', 'Misma parcela 35 de Alquiler50'],
  ['promo:galivivienda:parcela-40', 'promo:galivivienda:alquiler50-parcela-40-60-viviendas', 'Misma parcela 40 de Alquiler50'],
  ['promo:galivivienda:parcela-7', 'promo:galivivienda:alquiler50-parcela-7-14-viviendas', 'Misma parcela 7 de Alquiler50'],
  ['promo:galivivienda:alquiler-50', 'promo:galivivienda:alquiler50-parque-ofim-tico', 'Mismo programa paraguas Alquiler50 Parque Ofimático'],
];

const rejected = [
  ['promo:metrovacesa:abelia-residencial', 'Abelia Residencial está en Alicante'],
  ['promo:galivivienda:residencial-os-casta-os', 'Residencial Os Castaños está en Santiago de Compostela'],
  ['promo:galivivienda:residencial-pinos-altos', 'Residencial Pinos Altos está en Cadalso de los Vidrios (Madrid)'],
  ['promo:galivivienda:atalayas-de-la-dehesa-torres-i-y-ii', 'Atalayas de la Dehesa está en Madrid'],
  ['promo:galivivienda:torre-flor', 'Torre Flor está en Madrid'],
  ['promo:outra-forma-de-vivenda:la-borda', 'La Borda está en Barcelona y era una experiencia citada'],
  ['promo:outra-forma-de-vivenda:cooperativa-de-consumo-responsable-zocami-oca', 'Zocamiñoca es cooperativa de consumo, no promoción de vivienda'],
  ['promo:outra-forma-de-vivenda:cooperativa-de-vivendas-en-cesi-n-de-uso', 'Texto genérico, no nombre de promoción; el proyecto real es As Lavandeiras'],
  ['promo:amma-promocion:canido-fase-2', 'Canido está en Ferrol'],
  ['promo:casado:pr-xima-promoci-n-en-pedre-a', 'Pedreña está en Cantabria; el nombre indica ubicación fuera del área'],
  ['promo:gestlex:panti-obre-residencial', 'Pantiñobre no está en el área metropolitana monitorizada'],
  ['promo:carlos-luxury-realty:la-obra-nueva-en-culleredo-se-ampl-a-con-cuatro-viviendas-de-lujo-modulares-la', 'Titular de prensa convertido erróneamente en promoción; Carlos Luxury Realty es una agencia'],
];

const opportunityAliases = [
  ['298fd497ac2330d8', '348c39238441ca4a', 'Mismo artículo de Culleredo: Google News y URL directa de La Opinión'],
];

const rejectedOpportunities = [
  ['5f56a42bd5813ce9', 'Agregador EstateNearMe; no es fuente primaria ni aporta proyecto verificable'],
  ['d6eb6d2bfc0f1f85', 'Agregador EstateNearMe; Residencial Anceis requiere fuente oficial'],
  ['8fc5d00f7e1f57b6', 'Agregador EstateNearMe; Granxa da Torre requiere fuente oficial'],
  ['45576787635966eb', 'Artículo general de política de vivienda sin oportunidad, convocatoria ni proyecto accionable'],
  ['16f236ba4b44c6b8', 'Portal índice viviendasnuevas.com; listado de promociones, no una oportunidad accionable'],
  ['ff88fd98889e5cee', 'Agregador de subastas subastasdelboe.com; no es fuente primaria ni oportunidad de vivienda'],
  ['e57e6e05321e86fe', 'Página de trámites municipales tramitesayuntamiento.com; formulario administrativo, no oportunidad'],
];

const promotionLinks = [
  ['bdabb9944b86d576', 'promo:metrovacesa:residencial-caleida'],
  ['86fdf21ef58fab8b', 'promo:metrovacesa:residencial-caleida'],
  ['60642b80745db7f3', 'promo:metrovacesa:residencial-caleida'],
  ['5ec58d59de85b88d', 'promo:gestogar:xard-ns-da-rabadeira'],
  ['c1bd375b2dec31bf', 'promo:gestogar:xard-ns-da-rabadeira'],
  ['baf756794c1986c5', 'promo:gestogar:xard-ns-da-rabadeira'],
  ['a07415e5d32e332e', 'promo:gestogar:xard-ns-da-rabadeira'],
  ['9a31bfded0b8ef6a', 'promo:gestlex:residencial-a-chave'],
  ['6a3f5f4a53e4a03d', 'promo:igvs:arteixo-14-vpp'],
  ['b886ea456f086adf', 'promo:igvs:arteixo-14-vpp'],
  ['cb70454b5e2dc6ac', 'promo:igvs:culleredo-17-vpp'],
  ['85f3a51a78756f6a', 'promo:igvs:culleredo-17-vpp'],
];

const insertDecision = db.prepare(`
  INSERT INTO entity_aliases(entityKind, aliasId, canonicalId, reason, createdAt)
  VALUES ('promotion', ?, ?, ?, ?)
  ON CONFLICT(entityKind, aliasId) DO UPDATE SET
    canonicalId=excluded.canonicalId, reason=excluded.reason
`);
const getPromotion = db.prepare('SELECT * FROM gestora_promotions WHERE id = ?');
const updateOpportunity = db.prepare('UPDATE opportunities SET promotionId = ? WHERE promotionId = ?');
const deletePromotion = db.prepare('DELETE FROM gestora_promotions WHERE id = ?');
const improveCanonical = db.prepare(`
  UPDATE gestora_promotions SET
    location = CASE WHEN length(?) > length(location) THEN ? ELSE location END,
    details = COALESCE(NULLIF(details, ''), ?),
    link = CASE WHEN (? LIKE 'http%') THEN ? ELSE link END
  WHERE id = ?
`);

db.exec('BEGIN IMMEDIATE');
try {
  reclassifyPromotionScopes(db);
  db.prepare(`INSERT INTO gestoras(id,name,logo,website,phone,email,address,description)
    VALUES ('igvs','Instituto Galego da Vivenda e Solo','IGVS','https://igvs.xunta.gal/','','','','Organismo público de vivienda de la Xunta de Galicia.')
    ON CONFLICT(id) DO UPDATE SET website=excluded.website, description=excluded.description`).run();
  const seedPromotion = db.prepare(`INSERT INTO gestora_promotions
    (id,gestoraId,name,location,status,details,link,municipality,scopeStatus)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, location=excluded.location,
      status=excluded.status, details=excluded.details, link=excluded.link,
      municipality=excluded.municipality, scopeStatus=excluded.scopeStatus`);
  seedPromotion.run('promo:igvs:arteixo-14-vpp','igvs','14 viviendas de promoción pública en Arteixo','Arteixo','Suelo/Proyecto','14 viviendas públicas','https://igvs.xunta.gal/es/areas/vivienda/construcciones-vpp/arteixo-14-viviendas-de-promocion-publica','Arteixo','in_scope');
  seedPromotion.run('promo:igvs:culleredo-17-vpp','igvs','17 viviendas de promoción pública en Culleredo','Culleredo','Suelo/Proyecto','17 viviendas públicas','https://igvs.xunta.gal/es/areas/vivienda/construcciones-vpp/culleredo-17-viviendas-de-promocion-publica','Culleredo','in_scope');
  db.prepare("UPDATE gestoras SET description = '' WHERE id != 'igvs'").run();
  for (const [aliasId, canonicalId, reason] of aliases) {
    const alias = getPromotion.get(aliasId);
    const canonical = getPromotion.get(canonicalId);
    insertDecision.run(aliasId, canonicalId, reason, now);
    if (alias && canonical) {
      improveCanonical.run(alias.location || '', alias.location || '', alias.details || '', alias.link || '', alias.link || '', canonicalId);
      updateOpportunity.run(canonicalId, aliasId);
      deletePromotion.run(aliasId);
    }
  }
  for (const [id, reason] of rejected) {
    insertDecision.run(id, '__rejected__', reason, now);
    updateOpportunity.run(null, id);
    deletePromotion.run(id);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

// Enlaces de evidencia oficiales para las promociones verificadas manualmente.
const links = {
  'promo:amma-promocion:avenida-de-arteixo-123': 'https://ammapromocion.com/avenida-de-arteixo-123/',
  'promo:masar:finisterre-20': 'https://masar.es/finisterre-20/',
  'promo:metrovacesa:residencial-caleida': 'https://metrovacesa.com/promociones/a-coruna/a-coruna-capital/residencial-caleida',
  'promo:amma-promocion:plaza-de-vigo': 'https://ammapromocion.com/plaza-de-vigo/',
  'promo:galivivienda:alquiler50-parcela-27-90-viviendas': 'https://galivivienda.com/alquiler-50-parcela-27/',
  'promo:galivivienda:alquiler50-parcela-40-60-viviendas': 'https://galivivienda.com/alquiler-50-parcela-40/',
  'promo:galivivienda:alquiler50-parcela-7-14-viviendas': 'https://galivivienda.com/alquiler-50-parcela-7/',
};
const setLink = db.prepare('UPDATE gestora_promotions SET link = ? WHERE id = ?');
for (const [id, link] of Object.entries(links)) setLink.run(link, id);

db.exec('BEGIN IMMEDIATE');
try {
  const insertOpportunityDecision = db.prepare(`
  INSERT INTO entity_aliases(entityKind, aliasId, canonicalId, reason, createdAt)
  VALUES ('opportunity', ?, ?, ?, ?)
  ON CONFLICT(entityKind, aliasId) DO UPDATE SET canonicalId=excluded.canonicalId, reason=excluded.reason
`);
const deleteOpportunity = db.prepare('DELETE FROM opportunities WHERE id = ?');
for (const [aliasId, canonicalId, reason] of opportunityAliases) {
  insertOpportunityDecision.run(aliasId, canonicalId, reason, now);
  deleteOpportunity.run(aliasId);
}
for (const [id, reason] of rejectedOpportunities) {
  insertOpportunityDecision.run(id, '__rejected__', reason, now);
  deleteOpportunity.run(id);
}
const linkOpportunity = db.prepare('UPDATE opportunities SET promotionId = ? WHERE id = ?');
for (const [id, promotionId] of promotionLinks) linkOpportunity.run(promotionId, id);

// Revisiones de campo sustentadas por la fuente primaria o por el propio titular.
db.prepare('UPDATE opportunities SET totalViviendas = 4 WHERE id = ?').run('348c39238441ca4a');
db.prepare("UPDATE opportunities SET totalViviendas = NULL, status = 'Comercialización' WHERE id = ?").run('9a31bfded0b8ef6a');
db.prepare("UPDATE opportunities SET type = 'Vivienda protegida' WHERE promotionId IN ('promo:igvs:arteixo-14-vpp','promo:igvs:culleredo-17-vpp')").run();
db.prepare('UPDATE opportunities SET status = NULL WHERE id IN (?, ?)').run('d6c6918f5c233047', 'a6cec57917912992');

const setPublishedAt = db.prepare('UPDATE opportunities SET publishedAt = ? WHERE id = ? AND publishedAt IS NULL');
for (const row of db.prepare("SELECT id,url FROM opportunities WHERE sourceKind = 'firecrawl-search' AND publishedAt IS NULL").all()) {
  const publishedAt = extractPublishedAt(row.url);
  if (publishedAt) setPublishedAt.run(publishedAt, row.id);
}

// Las decisiones de reconciliación mandan sobre el historial público.
// Conservamos aliases/rechazos como evidencia, no eventos ya imposibles o contradichos.
db.prepare(`DELETE FROM events WHERE
  (entityKind = 'opportunity' AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = events.entityId)) OR
  (entityKind = 'promotion' AND NOT EXISTS (SELECT 1 FROM gestora_promotions p WHERE p.id = events.entityId)) OR
  (entityKind = 'cooperative' AND NOT EXISTS (SELECT 1 FROM cooperatives c WHERE c.cif = events.entityId AND c.active = 1)) OR
  (kind = 'status' AND entityKind = 'opportunity' AND EXISTS (
    SELECT 1 FROM opportunities o WHERE o.id = events.entityId AND events.newValue IS NOT o.status
  )) OR
  (kind = 'status' AND entityKind = 'promotion' AND EXISTS (
    SELECT 1 FROM gestora_promotions p WHERE p.id = events.entityId AND events.newValue IS NOT p.status
  )) OR
  (kind = 'price' AND entityKind = 'opportunity' AND EXISTS (
    SELECT 1 FROM opportunities o WHERE o.id = events.entityId AND events.newValue IS NOT CAST(o.precioMin AS TEXT)
  ))
`).run();
db.prepare("DELETE FROM gestoras WHERE id = 'carlos-luxury-realty' AND NOT EXISTS (SELECT 1 FROM gestora_promotions WHERE gestoraId = 'carlos-luxury-realty')").run();
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Reconciliadas ${aliases.length} variantes de promoción y ${opportunityAliases.length} señales; rechazados ${rejected.length + rejectedOpportunities.length} falsos positivos con decisión persistente.`);
