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
        FOREIGN KEY(gestoraId) REFERENCES gestoras(id) ON DELETE CASCADE
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
  }
  return dbInstance;
}

/**
 * Inserts or updates an opportunity in the SQLite database.
 * 
 * @param {DatabaseSync} db - Database instance
 * @param {Object} op - Opportunity object
 */
export function saveOpportunity(db, op) {
  const stmt = db.prepare(`
    INSERT INTO opportunities (
      id, title, url, source, sourceKind, publishedAt, firstSeenAt, lastSeenAt,
      location, type, status, summary, precioMin, precioMax, habitacionesMin,
      banosMin, promotora, totalViviendas, garaje, trastero, terraza, enriched, nombrePromocion
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      nombrePromocion = COALESCE(excluded.nombrePromocion, nombrePromocion)
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
    op.nombrePromocion || null
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
        name: p.name,
        location: p.location,
        status: p.status,
        details: p.details,
        link: p.link
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
  const stmt = db.prepare(`
    INSERT INTO gestora_promotions (id, gestoraId, name, location, status, details, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gestoraId = excluded.gestoraId,
      name = excluded.name,
      location = excluded.location,
      status = excluded.status,
      details = excluded.details,
      link = excluded.link
  `);
  stmt.run(p.id, p.gestoraId, p.name, p.location, p.status, p.details, p.link);
}

