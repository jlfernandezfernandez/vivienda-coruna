import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.mjs';
import { classifyPromotionLocation, municipalitySlug, MUNICIPALITIES, slugify } from './municipios.mjs';

let dbInstance = null;

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
    if (readOnly) return dbInstance;
    
    // Create tables schema
    dbInstance.exec(`
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
        enriched INTEGER,
        nombrePromocion TEXT,
        evidenceText TEXT,
        extractionMethod TEXT
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
        municipality TEXT,
        scopeStatus TEXT NOT NULL DEFAULT 'unverified',
        FOREIGN KEY(gestoraId) REFERENCES gestoras(id) ON DELETE CASCADE
      );

      -- Ground truth del Rexistro de Cooperativas da Xunta (CSV aberto, diff por CIF).
      CREATE TABLE IF NOT EXISTS cooperatives (
        cif TEXT PRIMARY KEY,
        numRegistro TEXT,
        name TEXT NOT NULL,
        foundedAt TEXT,
        foundingPartners INTEGER,
        address TEXT,
        postalCode TEXT,
        municipality TEXT,
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

      -- Cambios detectados entre corridas: base para "últimos cambios" en la web.
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
    `);

    // Migration: add columns to pre-existing databases that predate them
    const opportunityColumns = dbInstance.prepare(`PRAGMA table_info(opportunities)`).all().map((c) => c.name);
    if (!opportunityColumns.includes('enriched')) {
      dbInstance.exec(`ALTER TABLE opportunities ADD COLUMN enriched INTEGER`);
    }
    if (!opportunityColumns.includes('nombrePromocion')) {
      dbInstance.exec(`ALTER TABLE opportunities ADD COLUMN nombrePromocion TEXT`);
    }
    if (!opportunityColumns.includes('promotionId')) {
      dbInstance.exec(`ALTER TABLE opportunities ADD COLUMN promotionId TEXT`);
    }
    if (!opportunityColumns.includes('evidenceText')) {
      dbInstance.exec(`ALTER TABLE opportunities ADD COLUMN evidenceText TEXT`);
    }
    if (!opportunityColumns.includes('extractionMethod')) {
      dbInstance.exec(`ALTER TABLE opportunities ADD COLUMN extractionMethod TEXT`);
    }
    const sourceColumns = dbInstance.prepare(`PRAGMA table_info(sources)`).all().map((c) => c.name);
    if (!sourceColumns.includes('checkedAt')) {
      dbInstance.exec(`ALTER TABLE sources ADD COLUMN checkedAt TEXT`);
    }
    const cooperativeColumns = dbInstance.prepare(`PRAGMA table_info(cooperatives)`).all().map((c) => c.name);
    if (!cooperativeColumns.includes('active')) {
      dbInstance.exec(`ALTER TABLE cooperatives ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    }
    const promotionColumns = dbInstance.prepare(`PRAGMA table_info(gestora_promotions)`).all().map((c) => c.name);
    for (const col of ['entregaEstimada TEXT', 'buscaSocios INTEGER', 'aportacionInicial INTEGER', 'municipality TEXT', "scopeStatus TEXT NOT NULL DEFAULT 'unverified'"]) {
      if (!promotionColumns.includes(col.split(' ')[0])) {
        dbInstance.exec(`ALTER TABLE gestora_promotions ADD COLUMN ${col}`);
      }
    }
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
    const canonical = db.prepare('SELECT title,url,source,sourceKind,publishedAt,firstSeenAt FROM opportunities WHERE id = ?').get(alias.canonicalId);
    op = { ...op, id: alias.canonicalId, ...(canonical || {}) };
  }
  const old = db.prepare('SELECT status, precioMin FROM opportunities WHERE id = ?').get(op.id);
  if (!old) {
    logEvent(db, 'opportunity', op.id, 'new', op.title, null, op.type || null);
  } else {
    if (old.status && op.status && old.status !== op.status) {
      logEvent(db, 'opportunity', op.id, 'status', op.title, old.status, op.status);
    }
    if (old.precioMin != null && op.precioMin != null && old.precioMin !== op.precioMin) {
      logEvent(db, 'opportunity', op.id, 'price', op.title, String(old.precioMin), String(op.precioMin));
    }
  }

  const stmt = db.prepare(`
    INSERT INTO opportunities (
      id, title, url, source, sourceKind, publishedAt, firstSeenAt, lastSeenAt,
      location, type, status, summary, precioMin, precioMax, habitacionesMin,
      banosMin, promotora, totalViviendas, garaje, trastero, terraza, enriched,
      nombrePromocion, promotionId, evidenceText, extractionMethod
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      lastSeenAt = excluded.lastSeenAt,
      publishedAt = COALESCE(publishedAt, excluded.publishedAt),
      status = excluded.status,
      precioMin = excluded.precioMin,
      precioMax = excluded.precioMax,
      habitacionesMin = excluded.habitacionesMin,
      banosMin = excluded.banosMin,
      promotora = excluded.promotora,
      totalViviendas = excluded.totalViviendas,
      garaje = excluded.garaje,
      trastero = excluded.trastero,
      terraza = excluded.terraza,
      enriched = excluded.enriched,
      nombrePromocion = excluded.nombrePromocion,
      promotionId = excluded.promotionId,
      evidenceText = COALESCE(excluded.evidenceText, evidenceText),
      extractionMethod = COALESCE(excluded.extractionMethod, extractionMethod)
  `);

  stmt.run(
    op.id,
    op.title,
    op.url,
    op.source,
    op.sourceKind,
    op.publishedAt || null,
    op.firstSeenAt,
    op.lastSeenAt,
    op.location || null,
    op.type || null,
    op.status || null,
    op.summary || null,
    op.precioMin !== undefined ? op.precioMin : null,
    op.precioMax !== undefined ? op.precioMax : null,
    op.habitacionesMin !== undefined ? op.habitacionesMin : null,
    op.banosMin !== undefined ? op.banosMin : null,
    op.promotora || null,
    op.totalViviendas !== undefined ? op.totalViviendas : null,
    op.garaje === true ? 1 : (op.garaje === false ? 0 : null),
    op.trastero === true ? 1 : (op.trastero === false ? 0 : null),
    op.terraza === true ? 1 : (op.terraza === false ? 0 : null),
    op.enriched ? 1 : 0,
    op.nombrePromocion || null,
    op.promotionId || null,
    op.evidenceText || null,
    op.extractionMethod || null
  );
}

/**
 * Retrieves a single opportunity from the SQLite database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {string} id - Opportunity ID
 * @returns {Object|null} Opportunity object or null
 */
export function getOpportunity(db, id) {
  const stmt = db.prepare('SELECT * FROM opportunities WHERE id = ?');
  const rows = stmt.all(id);
  if (rows.length === 0) return null;
  const row = rows[0];
  
  return {
    ...row,
    garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
    trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
    terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
    enriched: row.enriched === 1,
  };
}

/**
 * Retrieves the latest opportunities ordered by date.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {number} limit - Maximum number of items
 * @returns {Array<Object>} List of opportunities
 */
export function getAllOpportunities(db, limit = 150) {
  const stmt = db.prepare(`
    SELECT * FROM (
      SELECT opportunities.*,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(promotionId, id)
          ORDER BY COALESCE(publishedAt, firstSeenAt) DESC, lastSeenAt DESC
        ) AS canonicalRank
      FROM opportunities
    )
    WHERE canonicalRank = 1
    ORDER BY COALESCE(publishedAt, firstSeenAt) DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit);
  return rows.map(({ canonicalRank: _canonicalRank, ...row }) => ({
    ...row,
    garaje: row.garaje === 1 ? true : (row.garaje === 0 ? false : null),
    trastero: row.trastero === 1 ? true : (row.trastero === 0 ? false : null),
    terraza: row.terraza === 1 ? true : (row.terraza === 0 ? false : null),
    enriched: row.enriched === 1,
  }));
}

/**
 * Inserts or updates a source log entry.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} source - Source log object
 */
export function saveSource(db, source) {
  const stmt = db.prepare(`
    INSERT INTO sources (name, url, kind, ok, scanned, checkedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      ok = excluded.ok,
      scanned = excluded.scanned,
      checkedAt = excluded.checkedAt
  `);
  stmt.run(
    source.name,
    source.url,
    source.kind,
    source.ok ? 1 : 0,
    source.scanned,
    new Date().toISOString()
  );
}

/**
 * Retrieves all source log entries.
 * 
 * @param {DatabaseSync} db - Database instance
 * @returns {Array<Object>} List of source entries
 */
export function getAllSources(db) {
  const stmt = db.prepare('SELECT * FROM sources');
  const rows = stmt.all();
  return rows.map(row => ({
    ...row,
    ok: row.ok === 1,
  }));
}

/**
 * Retrieves all cooperative managers along with their promotions.
 * 
 * @param {DatabaseSync} db - Database instance
 * @returns {Array<Object>} List of gestoras with promotions
 */
export function getAllGestoras(db) {
  const gestorasRows = db.prepare('SELECT * FROM gestoras').all();
  const promotionsRows = db.prepare("SELECT * FROM gestora_promotions WHERE scopeStatus = 'in_scope'").all();

  return gestorasRows.map(g => {
    const promotions = promotionsRows
      .filter(p => p.gestoraId === g.id)
      .map(p => ({
        id: p.id,
        name: p.name,
        location: p.location,
        status: p.status,
        details: p.details,
        link: p.link,
        entregaEstimada: p.entregaEstimada,
        buscaSocios: p.buscaSocios === 1 ? true : (p.buscaSocios === 0 ? false : null),
        aportacionInicial: p.aportacionInicial,
      }));
    return {
      ...g,
      promotions
    };
  });
}

/**
 * Inserts or updates a gestora in the database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} g - Gestora object
 */
export function saveGestora(db, g) {
  const exists = db.prepare('SELECT 1 FROM gestoras WHERE id = ?').get(g.id);
  if (!exists) logEvent(db, 'gestora', g.id, 'new', g.name, null, null);

  const stmt = db.prepare(`
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
  `);
  stmt.run(
    g.id,
    g.name,
    g.logo || '',
    g.website || '',
    g.phone || '',
    g.email || '',
    g.address || '',
    g.description || ''
  );
}

/**
 * Inserts or updates a promotion for a gestora in the database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} p - Promotion object
 */
export function saveGestoraPromotion(db, p) {
  const alias = db.prepare("SELECT canonicalId FROM entity_aliases WHERE entityKind = 'promotion' AND aliasId = ?").get(p.id);
  if (alias?.canonicalId === '__rejected__') return;
  if (alias) {
    const canonical = db.prepare('SELECT name FROM gestora_promotions WHERE id = ?').get(alias.canonicalId);
    p = { ...p, id: alias.canonicalId, name: canonical?.name || p.name };
  }

  const old = db.prepare('SELECT status, location FROM gestora_promotions WHERE id = ?').get(p.id);
  if (!old) {
    logEvent(db, 'promotion', p.id, 'new', p.name, null, p.status || null);
  } else if (old.status && p.status && old.status !== p.status) {
    logEvent(db, 'promotion', p.id, 'status', p.name, old.status, p.status);
  }

  const effectiveLocation = p.location || old?.location || '';
  const scope = classifyPromotionLocation(effectiveLocation);
  const stmt = db.prepare(`
    INSERT INTO gestora_promotions (
      id, gestoraId, name, location, status, details, link, entregaEstimada,
      buscaSocios, aportacionInicial, municipality, scopeStatus
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gestoraId = excluded.gestoraId,
      name = excluded.name,
      -- Prensa escribe placeholders ('' / 'Sin confirmar') que no deben pisar
      -- datos reales del catálogo de la gestora.
      location = COALESCE(NULLIF(excluded.location, ''), location),
      status = COALESCE(NULLIF(excluded.status, 'Sin confirmar'), status),
      details = COALESCE(NULLIF(excluded.details, ''), details),
      link = excluded.link,
      entregaEstimada = COALESCE(excluded.entregaEstimada, entregaEstimada),
      buscaSocios = COALESCE(excluded.buscaSocios, buscaSocios),
      aportacionInicial = COALESCE(excluded.aportacionInicial, aportacionInicial),
      municipality = excluded.municipality,
      scopeStatus = excluded.scopeStatus
  `);
  stmt.run(
    p.id,
    p.gestoraId,
    p.name,
    p.location,
    p.status,
    p.details,
    p.link,
    p.entregaEstimada || null,
    p.buscaSocios === true ? 1 : (p.buscaSocios === false ? 0 : null),
    p.aportacionInicial !== undefined && p.aportacionInicial !== null ? p.aportacionInicial : null,
    scope.municipality,
    scope.scopeStatus
  );
}

/**
 * Upserts a cooperative from the official Xunta registry (keyed by CIF).
 *
 * @param {DatabaseSync} db
 * @param {Object} c - Cooperative row
 */
export function saveCooperative(db, c) {
  const exists = db.prepare('SELECT active FROM cooperatives WHERE cif = ?').get(c.cif);
  if (!exists) logEvent(db, 'cooperative', c.cif, 'new', c.name, null, c.municipality || null);
  else if (exists.active === 0) logEvent(db, 'cooperative', c.cif, 'reappeared', c.name, null, c.municipality || null);

  db.prepare(`
    INSERT INTO cooperatives (cif, numRegistro, name, foundedAt, foundingPartners, address, postalCode, municipality, email, phone, firstSeenAt, lastSeenAt, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(cif) DO UPDATE SET
      numRegistro = excluded.numRegistro,
      name = excluded.name,
      foundedAt = excluded.foundedAt,
      foundingPartners = excluded.foundingPartners,
      address = excluded.address,
      postalCode = excluded.postalCode,
      municipality = excluded.municipality,
      email = excluded.email,
      phone = excluded.phone,
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

/**
 * Tras una importación del rexistro: las cooperativas cuyo lastSeenAt es anterior
 * a esta corrida ya no están en el CSV → evento 'disappeared'. Además, poda los
 * eventos con más de 90 días para que la tabla no crezca sin límite.
 *
 * @param {DatabaseSync} db
 * @param {string} seenAt - ISO timestamp de la corrida actual
 */
export function finalizeRegistryImport(db, seenAt) {
  const disappeared = db.prepare('SELECT cif, name, municipality FROM cooperatives WHERE active = 1 AND lastSeenAt < ?').all(seenAt);
  for (const c of disappeared) {
    logEvent(db, 'cooperative', c.cif, 'disappeared', c.name, c.municipality || null, null);
  }
  db.prepare('UPDATE cooperatives SET active = 0 WHERE active = 1 AND lastSeenAt < ?').run(seenAt);
  db.exec(`DELETE FROM events WHERE detectedAt < date('now', '-90 days')`);
}

/**
 * All registry cooperatives in the monitored area, newest first.
 *
 * @param {DatabaseSync} db
 * @returns {Array<Object>}
 */
export function getAllCooperatives(db) {
  return db.prepare('SELECT * FROM cooperatives WHERE active = 1 ORDER BY foundedAt DESC').all();
}

// ── Pipeline runs ──────────────────────────────────────────────────────────

export function ensureSchema(db) {
  // Full application schema — idempotent (IF NOT EXISTS)
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
      enriched INTEGER,
      nombrePromocion TEXT,
      promotionId TEXT,
      evidenceText TEXT,
      extractionMethod TEXT
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
      municipality TEXT,
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
      mode TEXT NOT NULL CHECK(mode IN ('fast','deep')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
      idempotencyKey TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_idempotency
      ON pipeline_runs(idempotencyKey) WHERE idempotencyKey IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_one_running
      ON pipeline_runs((1)) WHERE status = 'running';
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
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id);
  return row || null;
}

export function listRuns(db) {
  return db.prepare('SELECT * FROM pipeline_runs ORDER BY createdAt DESC').all();
}

export function getRunByIdempotencyKey(db, key) {
  if (!key) return null;
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE idempotencyKey = ?').get(key);
  return row || null;
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
  return getRunById(db, id);
}

export function getRunningRun(db) {
  const row = db.prepare("SELECT * FROM pipeline_runs WHERE status = 'running' LIMIT 1").get();
  return row || null;
}

// ── Repository (injectable into buildBackend) ──────────────────────────────

function opportunityDto(row) {
  if (!row) return null;
  const scope = classifyPromotionLocation(row.location || '');
  return {
    ...row,
    municipalitySlug: scope.municipality ? slugify(scope.municipality) : municipalitySlug(row.location),
    statusLabel: row.status || null,
    statusTone: statusTone(row.status),
  };
}

function statusTone(status) {
  if (status === 'Últimas unidades') return 'warning';
  if (['Comercialización', 'En construcción', 'En preventa'].includes(status)) return 'positive';
  return 'neutral';
}

function gestoraDto(gestora) {
  return {
    ...gestora,
    promotions: (gestora.promotions || []).map((promotion) => ({
      ...promotion,
      statusLabel: promotion.status || null,
      statusTone: statusTone(promotion.status),
    })),
  };
}

/**
 * Repository over either one caller-owned connection (tests/migrations) or a
 * connection factory (runtime). Factory connections close after each operation
 * so atomic database replacement is immediately visible.
 */
function normalizedSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function gestoraWithPress(db, id) {
  const gestora = getAllGestoras(db).find((item) => item.id === id);
  if (!gestora) return null;
  const needle = normalizedSearchText(gestora.name);
  const press = getAllOpportunities(db, 150)
    .filter((opportunity) => opportunity.sourceKind === 'market-alert')
    .filter((opportunity) => normalizedSearchText([
      opportunity.promotora,
      opportunity.title,
      opportunity.summary,
    ].join(' ')).includes(needle))
    .map(opportunityDto);
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
      db.close();
    }
  };
  const municipalities = MUNICIPALITIES.map((name) => ({ name, slug: slugify(name) }));

  return {
    health: () => withDb((db) => {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      return { database: integrity.integrity_check === 'ok' ? 'ok' : 'corrupt' };
    }),

    dashboard: () => withDb((db) => {
      const opportunities = getAllOpportunities(db, 150).map(opportunityDto);
      return {
        opportunities,
        sources: getAllSources(db),
        gestoras: getAllGestoras(db).map(gestoraDto),
        cooperatives: getAllCooperatives(db),
        events: getRecentEvents(db, 25),
        municipalities,
        coverage: options.coverageBuilder?.(opportunities)
          ?? options.coverage
          ?? { boundaries: [], markers: [] },
      };
    }),

    opportunityById: (id) => withDb((db) => opportunityDto(getOpportunity(db, id))),
    gestoras: () => withDb((db) => getAllGestoras(db).map(gestoraDto)),
    gestoraById: (id) => withDb((db) => gestoraWithPress(db, id)),
    cooperatives: () => withDb((db) => getAllCooperatives(db)),

    municipalityBySlug: (requestedSlug) => withDb((db) => {
      const name = MUNICIPALITIES.find((municipality) => slugify(municipality) === requestedSlug);
      if (!name) return null;
      const opportunities = getAllOpportunities(db, 150)
        .filter((row) => classifyPromotionLocation(row.location || '').municipality === name)
        .map(opportunityDto);
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
    runningRun: () => withDb((db) => getRunningRun(db)),
    nextQueuedRun: () => withDb((db) => db.prepare(
      "SELECT * FROM pipeline_runs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1",
    ).get() || null),
    interruptRunningRuns: () => withDb((db) => db.prepare(
      "UPDATE pipeline_runs SET status = 'interrupted', completedAt = ? WHERE status = 'running'",
    ).run(new Date().toISOString()).changes),
    sources: () => withDb((db) => getAllSources(db)),

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

