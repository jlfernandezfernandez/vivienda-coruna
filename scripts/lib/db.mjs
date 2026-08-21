import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.mjs';
import { listCurationCandidates, listCurationReviews, stageCurationReview } from './curation.mjs';
import { classifyPromotionLocation, municipalitySlug, MUNICIPALITIES, slugify, resolveMunicipality } from './municipios.mjs';
import { resolveGeoLocation } from './geocoder.mjs';

let dbInstance = null;

// Module-level flag: when a pipeline run transitions to succeeded the dashboard
// cache should be invalidated. Each repository instance holds its own cache
// object and checks this counter to detect invalidation.
let dashboardCacheVersion = 0;

export function invalidateDashboardCache() {
  dashboardCacheVersion += 1;
}

/**
 * Open and initialize the native SQLite database file.
 * 
 * @returns {DatabaseSync} Database instance
 */
export function getDatabase(options = {}) {
  if (!dbInstance) {
    const dbPath = process.env.DB_PATH || join(config.paths.root, 'src', 'data', 'monitor.db');
    const readOnly = options.readOnly ?? false;
    dbInstance = new DatabaseSync(dbPath, { readOnly });
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    if (!readOnly) {
      dbInstance.exec('PRAGMA journal_mode = WAL;');
      dbInstance.exec('PRAGMA synchronous = NORMAL;');
      dbInstance.exec('PRAGMA busy_timeout = 5000;');
    }
    if (readOnly) return dbInstance;
    
    ensureSchema(dbInstance);
  }
  return dbInstance;
}

/** Recalcula el ámbito geográfico solo dentro del escritor serializado. */
export function reclassifyPromotionScopes(db) {
  const rows = db.prepare('SELECT id, location FROM gestora_promotions').all();
  const update = db.prepare('UPDATE gestora_promotions SET municipality = ?, scopeStatus = ? WHERE id = ?');
  for (const row of rows) {
    const scope = classifyPromotionLocation(row.location);
    update.run(scope.municipality, scope.scopeStatus, row.id);
  }
}

/**
 * Records a detected change between runs.
 */
function logEvent(db, entityKind, entityId, kind, label, oldValue, newValue) {
  db.prepare(
    `INSERT INTO events (detectedAt, entityKind, entityId, kind, label, oldValue, newValue)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(new Date().toISOString(), entityKind, entityId, kind, label ?? null, oldValue ?? null, newValue ?? null);
}

/**
 * Most recent detected changes, newest first.
 *
 * @param {DatabaseSync} db
 * @param {number} limit
 * @returns {Array<Object>}
 */
export function getRecentEvents(db, limit = 25) {
  return db.prepare(`
    SELECT e.* FROM events e
    LEFT JOIN opportunities o ON e.entityKind = 'opportunity' AND o.id = e.entityId
    LEFT JOIN gestora_promotions p ON e.entityKind = 'promotion' AND p.id = e.entityId
    LEFT JOIN cooperatives c ON e.entityKind = 'cooperative' AND c.cif = e.entityId AND c.active = 1
    WHERE ((e.entityKind = 'opportunity' AND o.id IS NOT NULL)
       OR (e.entityKind = 'promotion' AND p.id IS NOT NULL)
       OR (e.entityKind = 'cooperative' AND c.cif IS NOT NULL))
    AND (e.kind != 'status' OR
      (e.entityKind = 'opportunity' AND e.newValue IS o.status) OR
      (e.entityKind = 'promotion' AND e.newValue IS p.status))
    AND (e.kind != 'price' OR
      (e.entityKind = 'opportunity' AND e.newValue IS CAST(o.precioMin AS TEXT)))
    ORDER BY e.id DESC LIMIT ?
  `).all(limit);
}

/**
 * Inserts or updates an opportunity in the SQLite database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} op - Opportunity object
 */
export function saveOpportunity(db, op) {
  const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind = 'opportunity' AND aliasId = ?").get(op.id);
  if (alias?.canonicalId === '__rejected__') return;
  if (alias) {
    op = { ...op, id: alias.canonicalId };
  }

  const existing = db.prepare('SELECT status, precioMin FROM opportunities WHERE id = ?').get(op.id);
  const now = new Date().toISOString();

  let lat = op.lat ?? null;
  let lng = op.lng ?? null;
  let municipality = op.municipality ?? op.municipio ?? null;
  let barrio = op.barrio ?? null;
  let geoPrecision = op.geoPrecision ?? null;

  if (lat == null || lng == null) {
    const geo = resolveGeoLocation(
      `${op.title} ${op.summary || ''} ${op.location || ''} ${op.barrio || ''} ${op.direccion || ''}`,
      resolveMunicipality(municipality || op.location)
    );
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      municipality = municipality || geo.municipality;
      barrio = barrio || geo.barrio;
      geoPrecision = geo.geoPrecision;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO opportunities (
      id, title, url, source, sourceKind, publishedAt, firstSeenAt, lastSeenAt,
      location, type, status, summary, precioMin, precioMax, habitacionesMin,
      banosMin, promotora, totalViviendas, garaje, trastero, terraza, piscina,
      ascensor, entregaEstimada, tipoPromocion, lat, lng, municipality, barrio,
      geoPrecision, enriched, nombrePromocion, promotionId, evidenceText, extractionMethod, extractorVersion
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      sourceKind = excluded.sourceKind,
      publishedAt = COALESCE(excluded.publishedAt, opportunities.publishedAt),
      lastSeenAt = excluded.lastSeenAt,
      location = COALESCE(excluded.location, opportunities.location),
      type = COALESCE(excluded.type, opportunities.type),
      status = COALESCE(excluded.status, opportunities.status),
      summary = COALESCE(excluded.summary, opportunities.summary),
      precioMin = COALESCE(excluded.precioMin, opportunities.precioMin),
      precioMax = COALESCE(excluded.precioMax, opportunities.precioMax),
      habitacionesMin = COALESCE(excluded.habitacionesMin, opportunities.habitacionesMin),
      banosMin = COALESCE(excluded.banosMin, opportunities.banosMin),
      promotora = COALESCE(excluded.promotora, opportunities.promotora),
      totalViviendas = COALESCE(excluded.totalViviendas, opportunities.totalViviendas),
      garaje = COALESCE(excluded.garaje, opportunities.garaje),
      trastero = COALESCE(excluded.trastero, opportunities.trastero),
      terraza = COALESCE(excluded.terraza, opportunities.terraza),
      piscina = COALESCE(excluded.piscina, opportunities.piscina),
      ascensor = COALESCE(excluded.ascensor, opportunities.ascensor),
      entregaEstimada = COALESCE(excluded.entregaEstimada, opportunities.entregaEstimada),
      tipoPromocion = COALESCE(excluded.tipoPromocion, opportunities.tipoPromocion),
      lat = COALESCE(excluded.lat, opportunities.lat),
      lng = COALESCE(excluded.lng, opportunities.lng),
      municipality = COALESCE(excluded.municipality, opportunities.municipality),
      barrio = COALESCE(excluded.barrio, opportunities.barrio),
      geoPrecision = COALESCE(excluded.geoPrecision, opportunities.geoPrecision),
      enriched = COALESCE(excluded.enriched, opportunities.enriched),
      nombrePromocion = COALESCE(excluded.nombrePromocion, opportunities.nombrePromocion),
      promotionId = COALESCE(excluded.promotionId, opportunities.promotionId),
      evidenceText = COALESCE(excluded.evidenceText, opportunities.evidenceText),
      extractionMethod = COALESCE(excluded.extractionMethod, opportunities.extractionMethod),
      extractorVersion = COALESCE(excluded.extractorVersion, opportunities.extractorVersion)
  `);

  stmt.run(
    op.id,
    op.title,
    op.url,
    op.source,
    op.sourceKind,
    op.publishedAt || null,
    op.firstSeenAt || now,
    op.lastSeenAt || now,
    op.location || null,
    op.type || null,
    op.status || null,
    op.summary || null,
    op.precioMin ?? null,
    op.precioMax ?? null,
    op.habitacionesMin ?? null,
    op.banosMin ?? null,
    op.promotora || null,
    op.totalViviendas ?? null,
    op.garaje ? 1 : (op.garaje === false ? 0 : null),
    op.trastero ? 1 : (op.trastero === false ? 0 : null),
    op.terraza ? 1 : (op.terraza === false ? 0 : null),
    op.piscina ? 1 : (op.piscina === false ? 0 : null),
    op.ascensor ? 1 : (op.ascensor === false ? 0 : null),
    op.entregaEstimada || null,
    op.tipoPromocion || null,
    lat,
    lng,
    municipality,
    barrio,
    geoPrecision,
    op.enriched ? 1 : 0,
    op.nombrePromocion || null,
    op.promotionId || null,
    op.evidenceText || null,
    op.extractionMethod || null,
    op.extractorVersion || null
  );

  if (existing) {
    if (op.status && existing.status && op.status !== existing.status) {
      logEvent(db, 'opportunity', op.id, 'status', `Estado cambiado: ${existing.status} → ${op.status}`, existing.status, op.status);
    }
    if (op.precioMin && existing.precioMin && op.precioMin !== existing.precioMin) {
      logEvent(db, 'opportunity', op.id, 'price', `Precio: ${existing.precioMin.toLocaleString('es-ES')} € → ${op.precioMin.toLocaleString('es-ES')} €`, String(existing.precioMin), String(op.precioMin));
    }
  } else {
    logEvent(db, 'opportunity', op.id, 'new', `Nueva oportunidad: ${op.title}`, null, null);
  }
}

export function getOpportunity(db, id) {
  const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind = 'opportunity' AND aliasId = ?").get(id);
  if (alias?.canonicalId === '__rejected__') return null;
  const canonicalId = alias ? alias.canonicalId : id;

  return db.prepare(`
    SELECT * FROM opportunities
    WHERE id = ?
      AND id NOT IN (
        SELECT aliasId FROM entity_aliases
        WHERE entityKind = 'opportunity' AND canonicalId = '__rejected__'
      )
  `).get(canonicalId);
}

export function getAllOpportunities(db, limit = 150) {
  const hasAliases = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_aliases'").get();
  const aliasClause = hasAliases ? `
    WHERE id NOT IN (
      SELECT aliasId FROM entity_aliases
      WHERE entityKind = 'opportunity' AND canonicalId = '__rejected__'
    )
  ` : '';

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT opportunities.*,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(promotionId, id)
          ORDER BY COALESCE(publishedAt, firstSeenAt) DESC, lastSeenAt DESC
        ) AS canonicalRank
      FROM opportunities
      ${aliasClause}
    )
    WHERE canonicalRank = 1
    ORDER BY COALESCE(publishedAt, firstSeenAt) DESC, lastSeenAt DESC
    LIMIT ?
  `).all(limit);

  return rows.map(({ canonicalRank: _canonicalRank, ...row }) => ({
    ...row,
    garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
    trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
    terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
    piscina: row.piscina === 1 ? true : (row.piscina === 0 ? false : null),
    ascensor: row.ascensor === 1 ? true : (row.ascensor === 0 ? false : null),
    enriched: row.enriched === 1,
  }));
}

export function saveSource(db, source) {
  db.prepare(`
    INSERT INTO sources (name, url, kind, ok, scanned, checkedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      url = excluded.url,
      kind = excluded.kind,
      ok = excluded.ok,
      scanned = excluded.scanned,
      checkedAt = excluded.checkedAt
  `).run(
    source.name,
    source.url,
    source.kind,
    source.ok ? 1 : 0,
    source.scanned ?? 0,
    source.checkedAt || new Date().toISOString()
  );
}

export function getAllSources(db) {
  return db.prepare('SELECT * FROM sources ORDER BY name ASC').all().map((row) => ({
    ...row,
    ok: row.ok === 1,
  }));
}

export function getAllGestoras(db) {
  const gestoras = db.prepare(`
    SELECT * FROM gestoras
    WHERE id NOT IN (
      SELECT aliasId FROM entity_aliases
      WHERE entityKind = 'gestora' AND canonicalId = '__rejected__'
    )
    ORDER BY name ASC
  `).all();

  const promotions = db.prepare(`
    SELECT * FROM gestora_promotions
    WHERE scopeStatus != 'out_of_scope'
      AND id NOT IN (
        SELECT aliasId FROM entity_aliases
        WHERE entityKind = 'promotion' AND canonicalId = '__rejected__'
      )
    ORDER BY buscaSocios DESC, name ASC
  `).all();

  const byGestora = new Map();
  for (const p of promotions) {
    if (!byGestora.has(p.gestoraId)) byGestora.set(p.gestoraId, []);
    byGestora.get(p.gestoraId).push(p);
  }

  return gestoras.map((g) => ({
    ...g,
    promotions: byGestora.get(g.id) || [],
  }));
}

export function saveGestora(db, g) {
  const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind = 'gestora' AND aliasId = ?").get(g.id);
  if (alias?.canonicalId === '__rejected__') return;
  if (alias) {
    g = { ...g, id: alias.canonicalId };
  }

  const existing = db.prepare('SELECT id FROM gestoras WHERE id = ?').get(g.id);

  db.prepare(`
    INSERT INTO gestoras (id, name, logo, website, phone, email, address, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      logo = excluded.logo,
      website = excluded.website,
      phone = excluded.phone,
      email = excluded.email,
      address = excluded.address,
      description = excluded.description
  `).run(g.id, g.name, g.logo, g.website, g.phone, g.email, g.address, g.description);

  if (!existing) {
    logEvent(db, 'gestora', g.id, 'new', `Nueva gestora incorporada: ${g.name}`, null, null);
  }
}

export function saveGestoraPromotion(db, p) {
  const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind = 'promotion' AND aliasId = ?").get(p.id);
  if (alias?.canonicalId === '__rejected__') return;
  if (alias) {
    p = { ...p, id: alias.canonicalId };
  }

  const existing = db.prepare('SELECT status, buscaSocios FROM gestora_promotions WHERE id = ?').get(p.id);
  const scope = classifyPromotionLocation(p.location);

  let lat = p.lat ?? null;
  let lng = p.lng ?? null;
  let municipality = p.municipality || scope.municipality || null;
  let barrio = p.barrio ?? null;
  let geoPrecision = p.geoPrecision ?? null;

  if (lat == null || lng == null) {
    const geo = resolveGeoLocation(`${p.name} ${p.details || ''} ${p.location || ''}`, municipality);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      municipality = municipality || geo.municipality;
      barrio = barrio || geo.barrio;
      geoPrecision = geo.geoPrecision;
    }
  }

  db.prepare(`
    INSERT INTO gestora_promotions (
      id, gestoraId, name, location, status, details, link,
      entregaEstimada, buscaSocios, aportacionInicial, precioMin, precioMax, municipality,
      barrio, lat, lng, geoPrecision, scopeStatus
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gestoraId = excluded.gestoraId,
      name = excluded.name,
      location = excluded.location,
      status = excluded.status,
      details = excluded.details,
      link = excluded.link,
      entregaEstimada = COALESCE(excluded.entregaEstimada, gestora_promotions.entregaEstimada),
      buscaSocios = COALESCE(excluded.buscaSocios, gestora_promotions.buscaSocios),
      aportacionInicial = COALESCE(excluded.aportacionInicial, gestora_promotions.aportacionInicial),
      precioMin = COALESCE(excluded.precioMin, gestora_promotions.precioMin),
      precioMax = COALESCE(excluded.precioMax, gestora_promotions.precioMax),
      municipality = excluded.municipality,
      barrio = COALESCE(excluded.barrio, gestora_promotions.barrio),
      lat = COALESCE(excluded.lat, gestora_promotions.lat),
      lng = COALESCE(excluded.lng, gestora_promotions.lng),
      geoPrecision = COALESCE(excluded.geoPrecision, gestora_promotions.geoPrecision),
      scopeStatus = excluded.scopeStatus
  `).run(
    p.id,
    p.gestoraId,
    p.name,
    p.location,
    p.status,
    p.details || null,
    p.link || null,
    p.entregaEstimada || null,
    p.buscaSocios ? 1 : 0,
    p.aportacionInicial || null,
    p.precioMin ?? null,
    p.precioMax ?? null,
    municipality,
    barrio,
    lat,
    lng,
    geoPrecision,
    scope.scopeStatus
  );

  if (existing) {
    if (existing.buscaSocios === 0 && p.buscaSocios) {
      logEvent(db, 'promotion', p.id, 'buscaSocios', `Nueva fase de captación de socios: ${p.name}`, '0', '1');
    }
    if (p.status && existing.status && p.status !== existing.status) {
      logEvent(db, 'promotion', p.id, 'status', `Estado: ${existing.status} → ${p.status}`, existing.status, p.status);
    }
  } else {
    logEvent(db, 'promotion', p.id, 'new', `Nueva promoción en seguimiento: ${p.name} (${p.location})`, null, null);
  }
}

export function saveCooperative(db, c) {
  const hasAliases = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_aliases'").get();
  if (hasAliases) {
    const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind = 'cooperative' AND aliasId = ?").get(c.cif);
    if (alias?.canonicalId === '__rejected__') return;
    if (alias) {
      c = { ...c, cif: alias.canonicalId };
    }
  }

  const existing = db.prepare('SELECT active, name FROM cooperatives WHERE cif = ?').get(c.cif);

  let lat = c.lat ?? null;
  let lng = c.lng ?? null;
  let barrio = c.barrio ?? null;
  let geoPrecision = c.geoPrecision ?? null;

  if (lat == null || lng == null) {
    const geo = resolveGeoLocation(`${c.name} ${c.address || ''} ${c.municipality || ''}`, c.municipality);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      barrio = geo.barrio;
      geoPrecision = geo.geoPrecision;
    }
  }

  if (!existing) {
    logEvent(db, 'cooperative', c.cif, 'new', `Nueva cooperativa registrada: ${c.name} (${c.municipality || 'A Coruña'})`, null, null);
  } else if (existing.active === 0) {
    logEvent(db, 'cooperative', c.cif, 'reactivated', `Cooperativa reactivada en registro: ${c.name}`, '0', '1');
  }

  const coopCols = db.prepare(`PRAGMA table_info(cooperatives)`).all().map((col) => col.name);
  const hasGeoCols = coopCols.includes('lat');

  if (hasGeoCols) {
    db.prepare(`
      INSERT INTO cooperatives (
        cif, numRegistro, name, foundedAt, foundingPartners, address,
        postalCode, municipality, barrio, lat, lng, geoPrecision,
        email, phone, firstSeenAt, lastSeenAt, active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(cif) DO UPDATE SET
        numRegistro = COALESCE(excluded.numRegistro, cooperatives.numRegistro),
        name = excluded.name,
        foundedAt = COALESCE(excluded.foundedAt, cooperatives.foundedAt),
        foundingPartners = COALESCE(excluded.foundingPartners, cooperatives.foundingPartners),
        address = COALESCE(excluded.address, cooperatives.address),
        postalCode = COALESCE(excluded.postalCode, cooperatives.postalCode),
        municipality = COALESCE(excluded.municipality, cooperatives.municipality),
        barrio = COALESCE(excluded.barrio, cooperatives.barrio),
        lat = COALESCE(excluded.lat, cooperatives.lat),
        lng = COALESCE(excluded.lng, cooperatives.lng),
        geoPrecision = COALESCE(excluded.geoPrecision, cooperatives.geoPrecision),
        email = COALESCE(excluded.email, cooperatives.email),
        phone = COALESCE(excluded.phone, cooperatives.phone),
        lastSeenAt = excluded.lastSeenAt,
        active = 1
    `).run(
      c.cif,
      c.numRegistro || null,
      c.name,
      c.foundedAt || null,
      c.foundingPartners ?? null,
      c.address || null,
      c.postalCode || null,
      c.municipality || null,
      barrio,
      lat,
      lng,
      geoPrecision,
      c.email || null,
      c.phone || null,
      c.firstSeenAt,
      c.lastSeenAt
    );
  } else {
    db.prepare(`
      INSERT INTO cooperatives (
        cif, numRegistro, name, foundedAt, foundingPartners, address,
        postalCode, municipality, email, phone, firstSeenAt, lastSeenAt, active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(cif) DO UPDATE SET
        numRegistro = COALESCE(excluded.numRegistro, cooperatives.numRegistro),
        name = excluded.name,
        foundedAt = COALESCE(excluded.foundedAt, cooperatives.foundedAt),
        foundingPartners = COALESCE(excluded.foundingPartners, cooperatives.foundingPartners),
        address = COALESCE(excluded.address, cooperatives.address),
        postalCode = COALESCE(excluded.postalCode, cooperatives.postalCode),
        municipality = COALESCE(excluded.municipality, cooperatives.municipality),
        email = COALESCE(excluded.email, cooperatives.email),
        phone = COALESCE(excluded.phone, cooperatives.phone),
        lastSeenAt = excluded.lastSeenAt,
        active = 1
    `).run(
      c.cif,
      c.numRegistro || null,
      c.name,
      c.foundedAt || null,
      c.foundingPartners ?? null,
      c.address || null,
      c.postalCode || null,
      c.municipality || null,
      c.email || null,
      c.phone || null,
      c.firstSeenAt,
      c.lastSeenAt
    );
  }
}

export function finalizeRegistryImport(db, seenAt) {
  const disappeared = db.prepare('SELECT cif, name, municipality FROM cooperatives WHERE active = 1 AND lastSeenAt < ?').all(seenAt);
  for (const c of disappeared) {
    logEvent(db, 'cooperative', c.cif, 'disappeared', c.name, c.municipality || null, null);
  }
  db.prepare('UPDATE cooperatives SET active = 0 WHERE active = 1 AND lastSeenAt < ?').run(seenAt);
  db.exec(`DELETE FROM events WHERE detectedAt < date('now', '-90 days')`);
}

export function purgeStaleData(db) {
  const opportunities = db.prepare(
    `DELETE FROM opportunities WHERE lastSeenAt < date('now', '-180 days')`
  ).run().changes;
  const events = db.prepare(
    `DELETE FROM events WHERE detectedAt < date('now', '-90 days')`
  ).run().changes;
  const pipelineRuns = db.prepare(
    `DELETE FROM pipeline_runs WHERE status IN ('succeeded', 'failed', 'interrupted') AND completedAt < date('now', '-30 days')`
  ).run().changes;
  return { opportunities, events, pipelineRuns };
}

export function getAllCooperatives(db) {
  return db.prepare('SELECT * FROM cooperatives WHERE active = 1 ORDER BY foundedAt DESC').all();
}

// ── Pipeline runs ──────────────────────────────────────────────────────────

export function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      sourceKind TEXT NOT NULL,
      publishedAt TEXT,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      location TEXT,
      type TEXT,
      status TEXT,
      summary TEXT,
      precioMin INTEGER,
      precioMax INTEGER,
      habitacionesMin INTEGER,
      banosMin INTEGER,
      promotora TEXT,
      totalViviendas INTEGER,
      garaje INTEGER,
      trastero INTEGER,
      terraza INTEGER,
      piscina INTEGER,
      ascensor INTEGER,
      entregaEstimada TEXT,
      tipoPromocion TEXT,
      lat REAL,
      lng REAL,
      municipality TEXT,
      barrio TEXT,
      geoPrecision TEXT,
      enriched INTEGER,
      nombrePromocion TEXT,
      promotionId TEXT,
      evidenceText TEXT,
      extractionMethod TEXT,
      extractorVersion TEXT
    );

    CREATE TABLE IF NOT EXISTS sources (
      name TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      kind TEXT NOT NULL,
      ok INTEGER NOT NULL,
      scanned INTEGER NOT NULL,
      checkedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS gestoras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT NOT NULL,
      website TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gestora_promotions (
      id TEXT PRIMARY KEY,
      gestoraId TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT,
      link TEXT,
      entregaEstimada TEXT,
      buscaSocios INTEGER,
      aportacionInicial INTEGER,
      precioMin INTEGER,
      precioMax INTEGER,
      municipality TEXT,
      barrio TEXT,
      lat REAL,
      lng REAL,
      geoPrecision TEXT,
      scopeStatus TEXT NOT NULL DEFAULT 'unverified',
      FOREIGN KEY(gestoraId) REFERENCES gestoras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cooperatives (
      cif TEXT PRIMARY KEY,
      numRegistro TEXT,
      name TEXT NOT NULL,
      foundedAt TEXT,
      foundingPartners INTEGER,
      address TEXT,
      postalCode TEXT,
      municipality TEXT,
      barrio TEXT,
      lat REAL,
      lng REAL,
      geoPrecision TEXT,
      email TEXT,
      phone TEXT,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entityKind TEXT NOT NULL,
      aliasId TEXT NOT NULL,
      canonicalId TEXT NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY(entityKind, aliasId)
    );

    CREATE TABLE IF NOT EXISTS curation_reviews (
      id TEXT PRIMARY KEY,
      entityKind TEXT NOT NULL CHECK(entityKind IN ('opportunity','gestora','promotion','cooperative')),
      entityId TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('confirm','update','create')),
      contentHash TEXT,
      resultHash TEXT,
      patchJson TEXT NOT NULL,
      evidenceJson TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','applied','conflict')),
      createdAt TEXT NOT NULL,
      appliedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_curation_reviews_entity
      ON curation_reviews(entityKind, entityId, createdAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_reviews_one_staged
      ON curation_reviews(entityKind, entityId) WHERE status = 'staged';

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detectedAt TEXT NOT NULL,
      entityKind TEXT NOT NULL,
      entityId TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT,
      oldValue TEXT,
      newValue TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('fast','deep','curate')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
      idempotencyKey TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      error TEXT
    );
  `);

  // SQLite cannot alter CHECK constraints. Upgrade databases created before
  // the curation run mode while preserving run history and idempotency keys.
  const pipelineSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pipeline_runs'",
  ).get()?.sql || '';
  if (!pipelineSchema.includes("'curate'")) {
    const legacyCols = db.prepare(`PRAGMA table_info(pipeline_runs)`).all().map(c => c.name);
    const hasMode = legacyCols.includes('mode');
    const hasIdempotency = legacyCols.includes('idempotencyKey');
    const modeExpr = hasMode ? 'mode' : "'fast'";
    const idempotencyExpr = hasIdempotency ? 'idempotencyKey' : 'NULL';
    const createdAtExpr = legacyCols.includes('createdAt') ? 'createdAt' : "COALESCE(startedAt, datetime('now'))";
    const completedAtExpr = legacyCols.includes('completedAt') ? 'completedAt' : (legacyCols.includes('endedAt') ? 'endedAt' : 'NULL');

    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE pipeline_runs RENAME TO pipeline_runs_legacy;
      CREATE TABLE pipeline_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('fast','deep','curate')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
        idempotencyKey TEXT,
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        error TEXT
      );
      INSERT INTO pipeline_runs (id, mode, status, idempotencyKey, createdAt, startedAt, completedAt, error)
      SELECT id, ${modeExpr}, status, ${idempotencyExpr}, ${createdAtExpr}, startedAt, ${completedAtExpr}, error FROM pipeline_runs_legacy;
      DROP TABLE pipeline_runs_legacy;
      COMMIT;
    `);
  }

  // Column migrations
  const oppCols = db.prepare(`PRAGMA table_info(opportunities)`).all().map((c) => c.name);
  for (const col of [
    'piscina INTEGER',
    'ascensor INTEGER',
    'entregaEstimada TEXT',
    'tipoPromocion TEXT',
    'lat REAL',
    'lng REAL',
    'municipality TEXT',
    'barrio TEXT',
    'geoPrecision TEXT',
    'enriched INTEGER',
    'nombrePromocion TEXT',
    'promotionId TEXT',
    'evidenceText TEXT',
    'extractionMethod TEXT',
    'extractorVersion TEXT'
  ]) {
    if (!oppCols.includes(col.split(' ')[0])) {
      db.exec(`ALTER TABLE opportunities ADD COLUMN ${col}`);
    }
  }

  const promoCols = db.prepare(`PRAGMA table_info(gestora_promotions)`).all().map((c) => c.name);
  for (const col of [
    'entregaEstimada TEXT',
    'buscaSocios INTEGER',
    'aportacionInicial INTEGER',
    'precioMin INTEGER',
    'precioMax INTEGER',
    'municipality TEXT',
    'barrio TEXT',
    'lat REAL',
    'lng REAL',
    'geoPrecision TEXT',
    "scopeStatus TEXT NOT NULL DEFAULT 'unverified'"
  ]) {
    if (!promoCols.includes(col.split(' ')[0])) {
      db.exec(`ALTER TABLE gestora_promotions ADD COLUMN ${col}`);
    }
  }

  const coopCols = db.prepare(`PRAGMA table_info(cooperatives)`).all().map((c) => c.name);
  for (const col of [
    'barrio TEXT',
    'lat REAL',
    'lng REAL',
    'geoPrecision TEXT',
    'active INTEGER NOT NULL DEFAULT 1'
  ]) {
    if (!coopCols.includes(col.split(' ')[0])) {
      db.exec(`ALTER TABLE cooperatives ADD COLUMN ${col}`);
    }
  }

  const sourceCols = db.prepare(`PRAGMA table_info(sources)`).all().map((c) => c.name);
  if (!sourceCols.includes('checkedAt')) {
    db.exec(`ALTER TABLE sources ADD COLUMN checkedAt TEXT;`);
  }
  db.exec(`UPDATE sources SET checkedAt = datetime('now') WHERE checkedAt IS NULL;`);

  // Invalidate known placeholder screenshots
  const placeholderScreenshotSha256 = 'e878950f8091ec010cf5cc723bdea027a8539cf7147cfea199c2f666232dcd4e';
  db.prepare(`
    UPDATE curation_reviews
    SET status = 'conflict',
        notes = CASE
          WHEN notes IS NULL OR notes = '' THEN 'invalidated: placeholder screenshot detected'
          ELSE notes || ' | invalidated: placeholder screenshot detected'
        END
    WHERE status = 'applied'
      AND EXISTS (
        SELECT 1
        FROM json_each(
          CASE
            WHEN json_valid(curation_reviews.evidenceJson) THEN
              CASE WHEN json_type(curation_reviews.evidenceJson) = 'array'
                THEN curation_reviews.evidenceJson ELSE '[]' END
            ELSE '[]'
          END
        ) AS evidence
        WHERE json_extract(
          CASE WHEN evidence.type = 'object' THEN evidence.value ELSE '{}' END,
          '$.screenshot.sha256'
        ) = ?
      )
  `).run(placeholderScreenshotSha256);

  // Create indexes after ensuring all columns exist
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_idempotency
      ON pipeline_runs(idempotencyKey) WHERE idempotencyKey IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_one_running
      ON pipeline_runs((1)) WHERE status = 'running';

    CREATE INDEX IF NOT EXISTS idx_opp_promotionId ON opportunities(promotionId);
    CREATE INDEX IF NOT EXISTS idx_opp_publishedAt ON opportunities(publishedAt);
    CREATE INDEX IF NOT EXISTS idx_opp_sourceKind ON opportunities(sourceKind);
    CREATE INDEX IF NOT EXISTS idx_promo_scopeStatus ON gestora_promotions(scopeStatus);
    CREATE INDEX IF NOT EXISTS idx_promo_gestoraId ON gestora_promotions(gestoraId);
    CREATE INDEX IF NOT EXISTS idx_events_detectedAt ON events(detectedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_coop_municipality_active ON cooperatives(municipality, active);
  `);
}

export function createRun(db, mode, idempotencyKey) {
  if (idempotencyKey) {
    const existing = getRunByIdempotencyKey(db, idempotencyKey);
    if (existing) return existing;
  }
  const id = `run-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO pipeline_runs (id, mode, status, idempotencyKey, createdAt) VALUES (?, ?, ?, ?, ?)'
  ).run(id, mode, 'queued', idempotencyKey, createdAt);
  return { id, mode, status: 'queued', idempotencyKey, createdAt };
}

export function getRunById(db, id) {
  return db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) || null;
}

export function listRuns(db) {
  return db.prepare('SELECT * FROM pipeline_runs ORDER BY createdAt DESC LIMIT 20').all();
}

export function getRunByIdempotencyKey(db, key) {
  return db.prepare('SELECT * FROM pipeline_runs WHERE idempotencyKey = ?').get(key) || null;
}

export function transitionRun(db, id, fromStatus, toStatus) {
  const now = new Date().toISOString();
  const sets = ['status = ?'];
  const params = [toStatus];
  if (toStatus === 'running') { sets.push('startedAt = ?'); params.push(now); }
  if (['succeeded', 'failed', 'interrupted'].includes(toStatus)) { sets.push('completedAt = ?'); params.push(now); }
  params.push(id, fromStatus);

  const result = db.prepare(
    `UPDATE pipeline_runs SET ${sets.join(', ')} WHERE id = ? AND status = ?`
  ).run(...params);

  if (result.changes === 0) return null;
  if (toStatus === 'succeeded') invalidateDashboardCache();
  return getRunById(db, id);
}

export function getRunningRun(db) {
  const row = db.prepare("SELECT * FROM pipeline_runs WHERE status = 'running' LIMIT 1").get();
  return row || null;
}

function statusTone(status) {
  if (!status) return 'neutral';
  const normalized = status.toLowerCase();
  if (normalized.includes('captaci') || normalized.includes('comercializ') || normalized.includes('obra')) {
    return 'success';
  }
  if (normalized.includes('licencia') || normalized.includes('proyecto') || normalized.includes('trámite') || normalized.includes('tramite')) {
    return 'warning';
  }
  return 'neutral';
}

function opportunityDto(row) {
  if (!row) return null;
  return {
    ...row,
    statusLabel: row.status || null,
    statusTone: statusTone(row.status),
    municipalitySlug: row.municipality ? municipalitySlug(row.municipality) : null,
    publishedAtLabel: row.publishedAt || row.firstSeenAt,
  };
}

function gestoraDto(gestora) {
  if (!gestora) return null;
  return {
    ...gestora,
    promotions: (gestora.promotions || []).map((promotion) => ({
      ...promotion,
      buscaSocios: promotion.buscaSocios === 1 ? true : (promotion.buscaSocios === 0 ? false : null),
      statusLabel: promotion.status || null,
      statusTone: statusTone(promotion.status),
      municipalitySlug: promotion.municipality ? municipalitySlug(promotion.municipality) : null,
    })),
  };
}

function gestoraWithPress(db, id) {
  const gestora = db.prepare(`
    SELECT * FROM gestoras
    WHERE id = ?
      AND id NOT IN (
        SELECT aliasId FROM entity_aliases
        WHERE entityKind = 'gestora' AND canonicalId = '__rejected__'
      )
  `).get(id);
  if (!gestora) return null;

  gestora.promotions = db.prepare(`
    SELECT * FROM gestora_promotions
    WHERE gestoraId = ?
      AND scopeStatus != 'out_of_scope'
      AND id NOT IN (
        SELECT aliasId FROM entity_aliases
        WHERE entityKind = 'promotion' AND canonicalId = '__rejected__'
      )
    ORDER BY buscaSocios DESC, name ASC
  `).all(id);

  const press = db.prepare(`
    SELECT * FROM (
      SELECT opportunities.*,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(promotionId, id)
          ORDER BY COALESCE(publishedAt, firstSeenAt) DESC, lastSeenAt DESC
        ) AS canonicalRank
      FROM opportunities
      WHERE (
        promotora LIKE ?
        OR title LIKE ?
        OR summary LIKE ?
      )
      AND id NOT IN (
        SELECT aliasId FROM entity_aliases
        WHERE entityKind = 'opportunity' AND canonicalId = '__rejected__'
      )
    )
    WHERE canonicalRank = 1
    ORDER BY COALESCE(publishedAt, firstSeenAt) DESC
    LIMIT 20
  `).all(`%${gestora.name}%`, `%${gestora.name}%`, `%${gestora.name}%`).map(({ canonicalRank: _canonicalRank, ...row }) => ({
    ...row,
    garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
    trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
    terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
    piscina: row.piscina === 1 ? true : (row.piscina === 0 ? false : null),
    ascensor: row.ascensor === 1 ? true : (row.ascensor === 0 ? false : null),
    enriched: row.enriched === 1,
  })).map(opportunityDto);

  return { ...gestoraDto(gestora), press };
}

export function createRepository(dbOrFactory, options = {}) {
  const isFactory = typeof dbOrFactory === 'function';
  const withDb = (operation) => {
    if (!isFactory) return operation(dbOrFactory);
    const db = dbOrFactory();
    try {
      db.exec?.('PRAGMA foreign_keys = ON;');
      return operation(db);
    } finally {
      db.close?.();
    }
  };
  const municipalities = MUNICIPALITIES.map((name) => ({ name, slug: slugify(name) }));

  const DASHBOARD_CACHE_TTL_MS = 60_000;
  let dashboardCache = null;

  return {
    health: () => withDb((db) => {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      return { database: integrity.integrity_check === 'ok' ? 'ok' : 'corrupt' };
    }),

    dashboard: () => {
      const now = Date.now();
      if (dashboardCache && dashboardCache.version === dashboardCacheVersion && now - dashboardCache.timestamp < DASHBOARD_CACHE_TTL_MS) {
        return dashboardCache.result;
      }
      const result = withDb((db) => {
        const opportunities = getAllOpportunities(db, 150).map(opportunityDto);
        const gestoras = getAllGestoras(db).map(gestoraDto);
        return {
          opportunities,
          sources: getAllSources(db),
          gestoras,
          cooperatives: getAllCooperatives(db),
          events: getRecentEvents(db, 25),
          municipalities,
          coverage: options.coverageBuilder?.(opportunities, gestoras)
            ?? options.coverage
            ?? { boundaries: [], markers: [] },
        };
      });
      dashboardCache = { result, timestamp: now, version: dashboardCacheVersion };
      return result;
    },

    opportunityById: (id) => withDb((db) => {
      const opportunity = opportunityDto(getOpportunity(db, id));
      if (!opportunity) return null;
      const events = db.prepare(
        `SELECT * FROM events WHERE entityKind = 'opportunity' AND entityId = ? ORDER BY detectedAt DESC LIMIT 20`
      ).all(id);
      return { ...opportunity, events };
    }),
    gestoras: () => withDb((db) => getAllGestoras(db).map(gestoraDto)),
    gestoraById: (id) => withDb((db) => gestoraWithPress(db, id)),
    cooperatives: () => withDb((db) => getAllCooperatives(db)),

    municipalityBySlug: (requestedSlug) => withDb((db) => {
      const name = MUNICIPALITIES.find((municipality) => slugify(municipality) === requestedSlug);
      if (!name) return null;
      const opportunities = db.prepare(`
        SELECT * FROM (
          SELECT opportunities.*,
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(promotionId, id)
              ORDER BY COALESCE(publishedAt, firstSeenAt) DESC, lastSeenAt DESC
            ) AS canonicalRank
          FROM opportunities
          WHERE location LIKE ?
        )
        WHERE canonicalRank = 1
        ORDER BY COALESCE(publishedAt, firstSeenAt) DESC
      `).all(`%${name}%`).map(({ canonicalRank: _canonicalRank, ...row }) => ({
        ...row,
        garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
        trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
        terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
        piscina: row.piscina === 1 ? true : (row.piscina === 0 ? false : null),
        ascensor: row.ascensor === 1 ? true : (row.ascensor === 0 ? false : null),
        enriched: row.enriched === 1,
      })).map(opportunityDto);
      const gestoraPromotions = db.prepare(
        "SELECT * FROM gestora_promotions WHERE municipality = ? AND scopeStatus = 'in_scope'",
      ).all(name).map((promotion) => ({
        ...promotion,
        buscaSocios: promotion.buscaSocios === 1 ? true : (promotion.buscaSocios === 0 ? false : null),
        statusLabel: promotion.status || null,
        statusTone: statusTone(promotion.status),
      }));
      const cooperatives = db.prepare(
        'SELECT * FROM cooperatives WHERE municipality = ? AND active = 1',
      ).all(name);
      return { slug: requestedSlug, name, opportunities, gestoraPromotions, cooperatives };
    }),

    seoRoutes: () => withDb((db) => ({
      municipalities: municipalities.map(({ slug }) => `/municipio/${slug}`),
      opportunities: db.prepare('SELECT id FROM opportunities').all().map(({ id }) => `/oportunidad/${id}`),
      gestoras: db.prepare('SELECT id FROM gestoras').all().map(({ id }) => `/gestora/${id}`),
    })),

    createRun: (mode, idempotencyKey) => withDb((db) => createRun(db, mode, idempotencyKey)),
    listRuns: () => withDb((db) => listRuns(db)),
    runById: (id) => withDb((db) => getRunById(db, id)),
    runByIdempotencyKey: (key) => withDb((db) => getRunByIdempotencyKey(db, key)),
    runningRun: () => withDb((db) => getRunningRun(db)),
    activeRun: () => withDb((db) => db.prepare(
      "SELECT * FROM pipeline_runs WHERE status IN ('queued','running') ORDER BY createdAt ASC LIMIT 1",
    ).get() || null),
    nextQueuedRun: () => withDb((db) => db.prepare(
      "SELECT * FROM pipeline_runs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1",
    ).get() || null),
    failQueuedRun: (id, error) => withDb((db) => {
      const failed = transitionRun(db, id, 'queued', 'failed');
      if (failed) db.prepare('UPDATE pipeline_runs SET error = ? WHERE id = ?').run(String(error).slice(0, 2000), id);
      return failed;
    }),
    interruptRunningRuns: () => withDb((db) => db.prepare(
      "UPDATE pipeline_runs SET status = 'interrupted', completedAt = ? WHERE status = 'running'",
    ).run(new Date().toISOString()).changes),
    sources: () => withDb((db) => getAllSources(db)),
    curationCandidates: () => withDb((db) => listCurationCandidates(db)),
    curationReviews: () => withDb((db) => listCurationReviews(db)),
    stageCurationReview: (review) => withDb((db) => stageCurationReview(db, review)),
    hasStagedCurationReviews: () => withDb((db) => Boolean(db.prepare(
      "SELECT 1 FROM curation_reviews WHERE status = 'staged' LIMIT 1",
    ).get())),

    diagnostics: () => withDb((db) => ({
      database: 'ok',
      opportunities: db.prepare('SELECT COUNT(*) n FROM opportunities').get().n,
      sources: db.prepare('SELECT COUNT(*) n FROM sources').get().n,
      gestoras: db.prepare('SELECT COUNT(*) n FROM gestoras').get().n,
      cooperatives: db.prepare('SELECT COUNT(*) n FROM cooperatives WHERE active = 1').get().n,
      runs: db.prepare('SELECT COUNT(*) n FROM pipeline_runs').get().n,
    })),
  };
}

// ── Geographic & Aggregation helpers for Frontend & Open Data APIs ─────────

export function getMapFeatures(db, webBasePath = '/') {
  const base = webBasePath.endsWith('/') ? webBasePath : `${webBasePath}/`;
  const opps = getAllOpportunities(db, 150);
  const gestoras = getAllGestoras(db);
  const markers = [];

  for (const op of opps) {
    if (op.lat == null || op.lng == null) continue;
    markers.push({
      id: op.id,
      title: op.nombrePromocion || op.title,
      category: op.type || op.tipoPromocion || 'Obra Nueva',
      type: op.type || op.tipoPromocion || 'Obra Nueva',
      status: op.status,
      precioMin: op.precioMin,
      habitacionesMin: op.habitacionesMin,
      totalViviendas: op.totalViviendas,
      promotora: op.promotora,
      municipality: op.municipality || op.location,
      barrio: op.barrio,
      lat: op.lat,
      lng: op.lng,
      url: `${base}oportunidad/${op.id}`,
      color: op.type === 'Cooperativa' ? '#1f4d36' : (op.type === 'Vivienda protegida' ? '#be123c' : '#0369a1'),
      kind: 'opportunity'
    });
  }

  for (const g of gestoras) {
    for (const pr of g.promotions) {
      if (pr.lat == null || pr.lng == null) continue;
      markers.push({
        id: pr.id,
        title: pr.name,
        category: pr.buscaSocios === 1 ? 'Cooperativa' : 'Obra Nueva',
        type: pr.buscaSocios === 1 ? 'Cooperativa' : 'Promoción nueva',
        status: pr.status,
        precioMin: pr.aportacionInicial ? pr.aportacionInicial * 4 : null,
        totalViviendas: null,
        promotora: g.name,
        municipality: pr.municipality || pr.location,
        barrio: pr.barrio,
        lat: pr.lat,
        lng: pr.lng,
        url: `${base}gestora/${pr.gestoraId}`,
        color: pr.buscaSocios === 1 ? '#1f4d36' : '#0369a1',
        kind: 'promotion'
      });
    }
  }

  return markers;
}

export function getMarketStats(db) {
  const opps = db.prepare(`
    SELECT precioMin, precioMax, totalViviendas, type, municipality, barrio
    FROM opportunities
  `).all();

  const promos = db.prepare(`
    SELECT p.status, p.municipality, p.barrio, p.buscaSocios, p.aportacionInicial
    FROM gestora_promotions p
  `).all();

  const groups = new Map();

  function getOrInit(key, name, kind) {
    if (!groups.has(key)) {
      groups.set(key, {
        name,
        kind,
        count: 0,
        prices: [],
        totalUnits: 0,
        coopCount: 0,
        vppCount: 0
      });
    }
    return groups.get(key);
  }

  for (const op of opps) {
    const loc = op.barrio || op.municipality || 'A Coruña';
    const kind = op.barrio ? 'barrio' : 'municipio';
    const entry = getOrInit(loc, loc, kind);

    entry.count++;
    if (op.precioMin) entry.prices.push(op.precioMin);
    if (op.totalViviendas) entry.totalUnits += op.totalViviendas;
    if (op.type === 'Cooperativa') entry.coopCount++;
    if (op.type === 'Vivienda protegida') entry.vppCount++;
  }

  for (const pr of promos) {
    const loc = pr.barrio || pr.municipality || 'A Coruña';
    const kind = pr.barrio ? 'barrio' : 'municipio';
    const entry = getOrInit(loc, loc, kind);

    entry.count++;
    if (pr.buscaSocios === 1) entry.coopCount++;
  }

  return Array.from(groups.values()).map(g => {
    const validPrices = g.prices.sort((a, b) => a - b);
    const minPrice = validPrices.length ? validPrices[0] : null;
    const maxPrice = validPrices.length ? validPrices[validPrices.length - 1] : null;
    const avgPrice = validPrices.length
      ? Math.round(validPrices.reduce((acc, p) => acc + p, 0) / validPrices.length)
      : null;

    return {
      name: g.name,
      kind: g.kind,
      count: g.count,
      minPrice,
      avgPrice,
      maxPrice,
      totalUnits: g.totalUnits,
      coopCount: g.coopCount,
      vppCount: g.vppCount
    };
  }).sort((a, b) => b.count - a.count);
}

export function getGeoJsonData(db, webBasePath = '/') {
  const features = getMapFeatures(db, webBasePath);
  return {
    type: 'FeatureCollection',
    generatedAt: new Date().toISOString(),
    features: features.map(f => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.lng, f.lat]
      },
      properties: {
        id: f.id,
        title: f.title,
        category: f.category,
        type: f.type,
        status: f.status,
        precioMin: f.precioMin,
        habitacionesMin: f.habitacionesMin,
        totalViviendas: f.totalViviendas,
        promotora: f.promotora,
        municipality: f.municipality,
        barrio: f.barrio,
        url: f.url,
        kind: f.kind
      }
    }))
  };
}

export function backfillGeocoding(db) {
  let oppUpdated = 0;
  let promoUpdated = 0;
  let coopUpdated = 0;

  const ungeoOpp = db.prepare('SELECT id, title, location, summary, barrio, evidenceText FROM opportunities WHERE lat IS NULL OR municipality IS NULL').all();
  const updateOppStmt = db.prepare('UPDATE opportunities SET lat = ?, lng = ?, municipality = ?, barrio = ?, geoPrecision = ? WHERE id = ?');
  for (const op of ungeoOpp) {
    const geo = resolveGeoLocation(
      `${op.title} ${op.summary || ''} ${op.location || ''} ${op.barrio || ''} ${(op.evidenceText || '').slice(0, 1000)}`,
      resolveMunicipality(op.location)
    );
    if (geo) {
      updateOppStmt.run(geo.lat, geo.lng, geo.municipality, geo.barrio || null, geo.geoPrecision, op.id);
      oppUpdated++;
    }
  }

  const ungeoPromo = db.prepare('SELECT id, name, location, details, barrio FROM gestora_promotions WHERE lat IS NULL OR municipality IS NULL').all();
  const updatePromoStmt = db.prepare('UPDATE gestora_promotions SET lat = ?, lng = ?, municipality = ?, barrio = ?, geoPrecision = ? WHERE id = ?');
  for (const pr of ungeoPromo) {
    const geo = resolveGeoLocation(
      `${pr.name} ${pr.details || ''} ${pr.location || ''} ${pr.barrio || ''}`,
      resolveMunicipality(pr.location)
    );
    if (geo) {
      updatePromoStmt.run(geo.lat, geo.lng, geo.municipality, geo.barrio || null, geo.geoPrecision, pr.id);
      promoUpdated++;
    }
  }

  const ungeoCoop = db.prepare('SELECT cif, name, address, municipality FROM cooperatives WHERE lat IS NULL').all();
  const updateCoopStmt = db.prepare('UPDATE cooperatives SET lat = ?, lng = ?, barrio = ?, geoPrecision = ? WHERE cif = ?');
  for (const cp of ungeoCoop) {
    const geo = resolveGeoLocation(`${cp.name} ${cp.address || ''} ${cp.municipality || ''}`, cp.municipality);
    if (geo) {
      updateCoopStmt.run(geo.lat, geo.lng, geo.barrio || null, geo.geoPrecision, cp.cif);
      coopUpdated++;
    }
  }

  return {
    opportunitiesUpdated: oppUpdated,
    promotionsUpdated: promoUpdated,
    cooperativesUpdated: coopUpdated,
  };
}
