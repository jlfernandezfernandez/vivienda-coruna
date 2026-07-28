import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.mjs';

let dbInstance = null;

/**
 * Open and initialize the native SQLite database file.
 * 
 * @returns {DatabaseSync} Database instance
 */
export function getDatabase() {
  if (!dbInstance) {
    const dbPath = join(config.paths.root, 'src', 'data', 'monitor.db');
    dbInstance = new DatabaseSync(dbPath);
    
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
        nombrePromocion TEXT
      );

      CREATE TABLE IF NOT EXISTS sources (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        ok INTEGER NOT NULL,
        scanned INTEGER NOT NULL
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
        lastSeenAt TEXT NOT NULL
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
    const promotionColumns = dbInstance.prepare(`PRAGMA table_info(gestora_promotions)`).all().map((c) => c.name);
    for (const col of ['entregaEstimada TEXT', 'buscaSocios INTEGER', 'aportacionInicial INTEGER']) {
      if (!promotionColumns.includes(col.split(' ')[0])) {
        dbInstance.exec(`ALTER TABLE gestora_promotions ADD COLUMN ${col}`);
      }
    }

    // Una sola familia de ids de promoción (prensa y web colisionan y se fusionan):
    // históricos "gestora:slug" y "site:gestora:slug" pasan a "promo:gestora:slug".
    const promoIds = dbInstance.prepare(`SELECT id FROM gestora_promotions WHERE id NOT LIKE 'promo:%'`).all();
    if (promoIds.length > 0) {
      // Transacción: si algo falla a mitad, no dejar ids a medio migrar.
      dbInstance.exec('BEGIN');
      try {
        dbInstance.exec(`DELETE FROM gestora_promotions WHERE id LIKE 'site:%' AND 'promo:' || substr(id, 6) IN (SELECT id FROM gestora_promotions)`);
        dbInstance.exec(`DELETE FROM gestora_promotions WHERE id NOT LIKE 'promo:%' AND id NOT LIKE 'site:%' AND 'promo:' || id IN (SELECT id FROM gestora_promotions)`);
        // Si "site:G:S" y "G:S" coexisten, ambos UPDATEs producirían "promo:G:S"
        // (UNIQUE crash): quedarse con el gemelo sin prefijo y borrar el de site.
        dbInstance.exec(`DELETE FROM gestora_promotions WHERE id LIKE 'site:%' AND substr(id, 6) IN (SELECT id FROM gestora_promotions WHERE id NOT LIKE 'promo:%' AND id NOT LIKE 'site:%')`);
        dbInstance.exec(`UPDATE gestora_promotions SET id = 'promo:' || substr(id, 6) WHERE id LIKE 'site:%'`);
        dbInstance.exec(`UPDATE gestora_promotions SET id = 'promo:' || id WHERE id NOT LIKE 'promo:%'`);
        dbInstance.exec('COMMIT');
      } catch (error) {
        dbInstance.exec('ROLLBACK');
        throw error;
      }
    }
  }
  return dbInstance;
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
  return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
}

/**
 * Inserts or updates an opportunity in the SQLite database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} op - Opportunity object
 */
export function saveOpportunity(db, op) {
  // Deduplicación por similitud de título: si ya existe una oportunidad
  // con un título muy parecido (mismo prefijo de 50 chars normalizado), 
  // la nueva se descarta para evitar duplicados de distintas fuentes RSS.
  const norm = (s) => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
  const newKey = norm(op.title).substring(0, 50);
  if (newKey.length > 10) {
    const existing = db.prepare('SELECT id, title, precioMin FROM opportunities').all();
    for (const e of existing) {
      const existKey = norm(e.title).substring(0, 50);
      if (existKey === newKey && e.id !== op.id) {
        // Ya existe: hacer upsert en el existente en vez de insertar nuevo
        op.id = e.id;
        break;
      }
    }
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
      banosMin, promotora, totalViviendas, garaje, trastero, terraza, enriched, nombrePromocion, promotionId
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      lastSeenAt = excluded.lastSeenAt,
      status = COALESCE(excluded.status, status),
      precioMin = COALESCE(excluded.precioMin, precioMin),
      precioMax = COALESCE(excluded.precioMax, precioMax),
      habitacionesMin = COALESCE(excluded.habitacionesMin, habitacionesMin),
      banosMin = COALESCE(excluded.banosMin, banosMin),
      promotora = COALESCE(excluded.promotora, promotora),
      totalViviendas = COALESCE(excluded.totalViviendas, totalViviendas),
      garaje = COALESCE(excluded.garaje, garaje),
      trastero = COALESCE(excluded.trastero, trastero),
      terraza = COALESCE(excluded.terraza, terraza),
      -- Sticky flag: una vez enriquecido por el LLM, no vuelve a 0.
      enriched = CASE WHEN excluded.enriched = 1 THEN 1 ELSE enriched END,
      nombrePromocion = COALESCE(excluded.nombrePromocion, nombrePromocion),
      promotionId = COALESCE(excluded.promotionId, promotionId)
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
    op.promotionId || null
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
    SELECT * FROM opportunities 
    ORDER BY COALESCE(publishedAt, firstSeenAt) DESC 
    LIMIT ?
  `);
  const rows = stmt.all(limit);
  return rows.map(row => ({
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
    INSERT INTO sources (name, url, kind, ok, scanned)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      ok = excluded.ok,
      scanned = excluded.scanned
  `);
  stmt.run(
    source.name,
    source.url,
    source.kind,
    source.ok ? 1 : 0,
    source.scanned
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
  const promotionsRows = db.prepare('SELECT * FROM gestora_promotions').all();

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
  const old = db.prepare('SELECT status FROM gestora_promotions WHERE id = ?').get(p.id);
  if (!old) {
    logEvent(db, 'promotion', p.id, 'new', p.name, null, p.status || null);
  } else if (old.status && p.status && old.status !== p.status) {
    logEvent(db, 'promotion', p.id, 'status', p.name, old.status, p.status);
  }

  const stmt = db.prepare(`
    INSERT INTO gestora_promotions (id, gestoraId, name, location, status, details, link, entregaEstimada, buscaSocios, aportacionInicial)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      aportacionInicial = COALESCE(excluded.aportacionInicial, aportacionInicial)
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
    p.aportacionInicial !== undefined && p.aportacionInicial !== null ? p.aportacionInicial : null
  );
}

/**
 * Upserts a cooperative from the official Xunta registry (keyed by CIF).
 *
 * @param {DatabaseSync} db
 * @param {Object} c - Cooperative row
 */
export function saveCooperative(db, c) {
  const exists = db.prepare('SELECT 1 FROM cooperatives WHERE cif = ?').get(c.cif);
  if (!exists) logEvent(db, 'cooperative', c.cif, 'new', c.name, null, c.municipality || null);

  db.prepare(`
    INSERT INTO cooperatives (cif, numRegistro, name, foundedAt, foundingPartners, address, postalCode, municipality, email, phone, firstSeenAt, lastSeenAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      lastSeenAt = excluded.lastSeenAt
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
  const disappeared = db.prepare('SELECT cif, name, municipality FROM cooperatives WHERE lastSeenAt < ?').all(seenAt);
  for (const c of disappeared) {
    logEvent(db, 'cooperative', c.cif, 'disappeared', c.name, c.municipality || null, null);
  }
  db.exec(`DELETE FROM events WHERE detectedAt < date('now', '-90 days')`);
}

/**
 * All registry cooperatives in the monitored area, newest first.
 *
 * @param {DatabaseSync} db
 * @returns {Array<Object>}
 */
export function getAllCooperatives(db) {
  return db.prepare('SELECT * FROM cooperatives ORDER BY foundedAt DESC').all();
}

