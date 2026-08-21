import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { validateExtractedHousingData } from './llm.mjs';
import { classifyPromotionLocation } from './municipios.mjs';
import { statusLabels } from './statuses.mjs';
import { rejectedOpportunities, rejectedPromotions } from './rejections.mjs';

const ENTITY_CONFIG = Object.freeze({
  opportunity: {
    table: 'opportunities',
    idField: 'id',
    mutable: new Set([
      'location', 'type', 'status', 'summary', 'precioMin', 'precioMax',
      'habitacionesMin', 'banosMin', 'promotora', 'totalViviendas',
      'garaje', 'trastero', 'terraza', 'nombrePromocion',
    ]),
    creatable: new Set([
      'title', 'url', 'publishedAt',
      'location', 'type', 'status', 'summary', 'precioMin', 'precioMax',
      'habitacionesMin', 'banosMin', 'promotora', 'totalViviendas', 'garaje',
      'trastero', 'terraza', 'nombrePromocion',
    ]),
    required: ['title', 'url', 'location'],
    defaults: { publishedAt: null, type: 'Promoción nueva', status: null, summary: null, enriched: 1, extractionMethod: 'hermes-curator' },
    // Derived columns are written by the geocoder/LLM backfill, not by the
    // curator. They must not invalidate a prior review and re-queue an entity
    // whose semantic (curator-editable) content is unchanged.
    hashExcluded: new Set([
      'lastSeenAt', 'piscina', 'ascensor', 'entregaEstimada', 'tipoPromocion',
      'lat', 'lng', 'municipality', 'barrio', 'geoPrecision',
    ]),
  },
  gestora: {
    table: 'gestoras',
    idField: 'id',
    mutable: new Set(['name', 'logo', 'website', 'phone', 'email', 'address', 'description']),
    creatable: new Set(['name', 'logo', 'website', 'phone', 'email', 'address', 'description']),
    required: ['name', 'website'],
    defaults: { logo: '', phone: '', email: '', address: '', description: '' },
    hashExcluded: new Set(),
  },
  promotion: {
    table: 'gestora_promotions',
    idField: 'id',
    mutable: new Set([
      'gestoraId', 'name', 'location', 'status', 'details', 'link',
      'entregaEstimada', 'buscaSocios', 'aportacionInicial', 'precioMin', 'precioMax',
    ]),
    creatable: new Set([
      'gestoraId', 'name', 'location', 'status', 'details', 'link', 'entregaEstimada',
      'buscaSocios', 'aportacionInicial', 'precioMin', 'precioMax',
    ]),
    required: ['gestoraId', 'name', 'location', 'status'],
    defaults: { details: null, link: null, entregaEstimada: null, buscaSocios: null, aportacionInicial: null },
    hashExcluded: new Set(['barrio', 'lat', 'lng', 'geoPrecision']),
  },
  cooperative: {
    table: 'cooperatives',
    idField: 'cif',
    // Registry-owned identity/state fields are intentionally immutable here.
    mutable: new Set(['address', 'postalCode', 'email', 'phone']),
    creatable: new Set(),
    required: [],
    defaults: {},
    hashExcluded: new Set(['lastSeenAt', 'barrio', 'lat', 'lng', 'geoPrecision']),
  },
});

const NUMBER_FIELDS = new Set([
  'precioMin', 'precioMax', 'habitacionesMin', 'banosMin',
  'totalViviendas', 'aportacionInicial',
]);
const BOOLEAN_FIELDS = new Set(['garaje', 'trastero', 'terraza', 'buscaSocios']);
const STATUS_VALUES = new Set([...statusLabels(), 'Sin confirmar']);
const OPPORTUNITY_TYPES = new Set(['Cooperativa', 'Promoción nueva', 'Suelo', 'Vivienda protegida']);
const MUNICIPALITIES = new Set(['A Coruña', 'Arteixo', 'Culleredo', 'Oleiros', 'Cambre', 'Sada', 'Bergondo', 'Carral', 'Abegondo']);
const OPPORTUNITY_GROUNDED_FIELDS = new Map([
  ['precioMin', 'precioMin'], ['precioMax', 'precioMax'],
  ['habitacionesMin', 'habitacionesMin'], ['banosMin', 'banosMin'],
  ['promotora', 'promotora'], ['totalViviendas', 'totalViviendas'],
  ['garaje', 'garaje'], ['trastero', 'trastero'], ['terraza', 'terraza'],
  ['status', 'estado'], ['nombrePromocion', 'nombrePromocion'],
]);


function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function curationContentHash(record) {
  return createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex');
}

function entityContentHash(entityKind, record) {
  const excluded = configFor(entityKind).hashExcluded;
  const stable = Object.fromEntries(Object.entries(record).filter(([field]) => !excluded.has(field)));
  return curationContentHash(stable);
}

function configFor(entityKind) {
  const config = ENTITY_CONFIG[entityKind];
  if (!config) throw new Error('invalid_entity_kind');
  return config;
}

function getEntity(db, entityKind, entityId) {
  const config = configFor(entityKind);
  return db.prepare(`SELECT * FROM ${config.table} WHERE ${config.idField} = ?`).get(entityId) || null;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function presentReview(row) {
  if (!row) return null;
  return {
    ...row,
    patch: parseJson(row.patchJson, {}),
    evidence: parseJson(row.evidenceJson, []),
  };
}

export function listCurationCandidates(db) {
  const latest = new Map();
  for (const row of db.prepare(`
    SELECT * FROM curation_reviews
    WHERE status = 'applied'
    ORDER BY COALESCE(appliedAt, createdAt) DESC
  `).all()) {
    const key = `${row.entityKind}:${row.entityId}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  const staged = new Map(db.prepare(
    "SELECT entityKind,entityId,contentHash,id FROM curation_reviews WHERE status = 'staged'"
  ).all().map((row) => [`${row.entityKind}:${row.entityId}`, row]));

  // Falsos positivos ya revisados y programados para rechazo en la
  // reconciliación. No deben reaparecer como candidatos: su borrado es
  // transaccional y ocurre dentro del pipeline, pero mientras tanto bloquearían
  // la puerta de completitud de `curate` (curation_incomplete) sin que exista
  // una acción de API para rechazarlos.
  const rejectedIds = new Map([
    ['opportunity', new Set(rejectedOpportunities.map(([id]) => id))],
    ['promotion', new Set(rejectedPromotions.map(([id]) => id))],
  ]);

  const candidates = [];
  for (const [entityKind, config] of Object.entries(ENTITY_CONFIG)) {
    const rejected = rejectedIds.get(entityKind);
    for (const record of db.prepare(`SELECT * FROM ${config.table}`).all()) {
      const entityId = String(record[config.idField]);
      if (rejected?.has(entityId)) continue;
      const contentHash = entityContentHash(entityKind, record);
      const key = `${entityKind}:${entityId}`;
      const lastReview = latest.get(key) || null;
      const stagedReview = staged.get(key) || null;
      if (lastReview?.resultHash === contentHash) continue;
      if (stagedReview?.contentHash === contentHash) continue;
      candidates.push({
        entityKind,
        entityId,
        contentHash,
        record,
        lastReview: presentReview(lastReview),
      });
    }
  }
  return candidates;
}

function isNonPublicEvidenceHost(rawHostname) {
  const host = rawHostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = isIP(host);
  if (kind === 4) {
    const octets = host.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && octets[2] === 100)
      || (a === 203 && b === 0 && octets[2] === 113);
  }
  if (kind === 6) {
    return host === '::' || host === '::1'
      || /^f[cd]/.test(host)
      || /^fe/.test(host)
      || /^ff/.test(host)
      || host.startsWith('::ffff:')
      || /^2001:db8(?::|$)/.test(host);
  }
  return false;
}

function validateEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 3) {
    throw new Error('evidence_required');
  }
  let hasScreenshot = false;
  for (const item of evidence) {
    if (!item || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) throw new Error('invalid_evidence_url');
    let parsedUrl;
    try { parsedUrl = new URL(item.url); } catch { throw new Error('invalid_evidence_url'); }
    if (parsedUrl.username || parsedUrl.password || isNonPublicEvidenceHost(parsedUrl.hostname)) {
      throw new Error('invalid_evidence_url');
    }
    if (typeof item.excerpt !== 'string' || item.excerpt.trim().length < 5 || item.excerpt.length > 2000) {
      throw new Error('invalid_evidence_excerpt');
    }
    if (item.screenshot != null) {
      const { ref, sha256, capturedAt } = item.screenshot || {};
      if (typeof ref !== 'string'
        || !/^vivienda-curation\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,300}\.(?:png|jpe?g|webp)$/i.test(ref)
        || ref.includes('..')
        || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)
        || typeof capturedAt !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt)
        || Number.isNaN(Date.parse(capturedAt))
        || new Date(capturedAt).toISOString() !== capturedAt) {
        throw new Error('invalid_screenshot_evidence');
      }
      hasScreenshot = true;
    }
  }
  if (!hasScreenshot) throw new Error('screenshot_required');
}

function validateGroundedOpportunityPatch(patch, evidence) {
  if (![...OPPORTUNITY_GROUNDED_FIELDS.keys()].some((field) => patch[field] != null)) return;
  const parsed = { ...patch, estado: patch.status };
  const source = evidence.map((item) => `${item.url}\n${item.excerpt}`).join('\n');
  const validated = validateExtractedHousingData(parsed, '', source);
  for (const [field, validatedField] of OPPORTUNITY_GROUNDED_FIELDS) {
    if (patch[field] != null && validated[validatedField] !== patch[field]) {
      throw new Error(`ungrounded_field:${field}`);
    }
  }
}

const normalizedEvidence = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9@.+:/-]+/g, ' ').replace(/\s+/g, ' ').trim();

const evidenceText = (evidence) => evidence.map((item) => `${item.url}\n${item.excerpt}`).join('\n');

function numericEvidence(value, source) {
  const expected = String(value).replace(/\D/g, '');
  return (String(source).match(/\d[\d.,\s]*/g) || [])
    .some((token) => token.replace(/\D/g, '') === expected);
}

function urlEvidence(field, value, evidence) {
  let target;
  try { target = new URL(value); } catch { return false; }
  return evidence.some((item) => {
    try {
      const cited = new URL(item.url);
      if (field === 'website' || field === 'logo') return cited.origin === target.origin;
      return cited.origin === target.origin && cited.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '');
    } catch { return false; }
  }) || normalizedEvidence(evidenceText(evidence)).includes(normalizedEvidence(value));
}

function gestoraEvidenceName(db, gestoraId) {
  const staged = db.prepare(
    "SELECT patchJson FROM curation_reviews WHERE entityKind='gestora' AND entityId=? AND action IN ('create','update') AND status='staged'",
  ).get(gestoraId);
  const stagedName = staged ? parseJson(staged.patchJson, {}).name : null;
  if (stagedName) return stagedName;
  return db.prepare('SELECT name FROM gestoras WHERE id = ?').get(gestoraId)?.name || null;
}

function validatePatchEvidence(db, entityKind, patch, evidence) {
  const source = evidenceText(evidence);
  const normalizedSource = normalizedEvidence(source);
  for (const [field, value] of Object.entries(patch)) {
    if (entityKind === 'opportunity' && OPPORTUNITY_GROUNDED_FIELDS.has(field)) continue;
    if (field === 'gestoraId') {
      const name = gestoraEvidenceName(db, value);
      if (!name || !normalizedSource.includes(normalizedEvidence(name))) throw new Error('ungrounded_field:gestoraId');
    } else if (['url', 'website', 'link', 'logo'].includes(field)) {
      if (!urlEvidence(field, value, evidence)) throw new Error(`ungrounded_field:${field}`);
    } else if (field === 'phone') {
      const digits = value.replace(/\D/g, '');
      if (!digits || !(source.match(/[+\d][\d\s().-]{6,}/g) || []).some((token) => token.replace(/\D/g, '') === digits)) throw new Error('ungrounded_field:phone');
    } else if (typeof value === 'number') {
      if (!numericEvidence(value, source)) throw new Error(`ungrounded_field:${field}`);
    } else if (typeof value === 'boolean') {
      const BOOLEAN_PATTERNS = {
        buscaSocios: value
          ? /\b(?:busca|admite|incorpora)\s+(?:nuevos?\s+)?socios?\b/i
          : /\b(?:no busca|no admite|completa|sin plazas)\b/i,
        garaje: value
          ? /\b(?:con\s+)?garaje\b/i
          : /\b(?:sin\s+garaje|no\s+tiene\s+garaje)\b/i,
        trastero: value
          ? /\b(?:con\s+)?trastero\b/i
          : /\b(?:sin\s+trastero|no\s+tiene\s+trastero)\b/i,
        terraza: value
          ? /\b(?:con\s+)?terraza\b/i
          : /\b(?:sin\s+terraza|no\s+tiene\s+terraza)\b/i,
      };
      const pattern = BOOLEAN_PATTERNS[field] || null;
      if (!pattern || !pattern.test(source)) throw new Error(`ungrounded_field:${field}`);
    } else {
      const normalizedValue = normalizedEvidence(value);
      if (!normalizedValue || !normalizedSource.includes(normalizedValue)) throw new Error(`ungrounded_field:${field}`);
    }
  }
}

function normalizePatch(config, patch, fields = config.mutable) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid_patch');
  const normalized = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!fields.has(field)) throw new Error(`field_not_allowed:${field}`);
    if (value === null) throw new Error(`null_not_allowed:${field}`);
    const expectedType = NUMBER_FIELDS.has(field) ? 'number' : BOOLEAN_FIELDS.has(field) ? 'boolean' : 'string';
    if (typeof value !== expectedType) throw new Error(`invalid_field_type:${field}`);
    if (typeof value === 'string') {
      const maxLength = ['summary', 'description', 'details'].includes(field) ? 4000 : ['url', 'website', 'link', 'logo'].includes(field) ? 2048 : 500;
      if (!value.trim() || value.length > maxLength) throw new Error(`invalid_field_value:${field}`);
      if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('invalid_format:email');
      if (field === 'phone' && !/^\d{7,15}$/.test(value.replace(/\D/g, ''))) throw new Error('invalid_format:phone');
      if (field === 'postalCode' && !/^\d{5}$/.test(value)) throw new Error('invalid_format:postalCode');
      if (field === 'publishedAt' && Number.isNaN(Date.parse(value))) throw new Error('invalid_format:publishedAt');
      if (field === 'status' && !STATUS_VALUES.has(value)) throw new Error('invalid_enum:status');
      if (field === 'type' && !OPPORTUNITY_TYPES.has(value)) throw new Error('invalid_enum:type');
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) throw new Error(`invalid_field_value:${field}`);
      const ranges = {
        precioMin: [100_000, 2_000_000], precioMax: [100_000, 3_000_000],
        habitacionesMin: [1, 8], banosMin: [1, 6], totalViviendas: [2, 2000],
        aportacionInicial: [0, 2_000_000],
      };
      if (ranges[field] && (value < ranges[field][0] || value > ranges[field][1])) throw new Error(`invalid_range:${field}`);
    }
    if (['url', 'website', 'link', 'logo'].includes(field)) {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error(`invalid_url:${field}`); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`invalid_url:${field}`);
    }
    normalized[field] = typeof value === 'string' ? value.trim() : value;
  }
  return normalized;
}

function validateReviewInput(db, input) {
  const config = configFor(input?.entityKind);
  if (!['confirm', 'update', 'create'].includes(input?.action)) throw new Error('invalid_action');
  if (typeof input.entityId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(input.entityId)) {
    throw new Error('entity_id_required');
  }
  const current = getEntity(db, input.entityKind, input.entityId);
  if (input.action === 'create' && input.entityKind === 'cooperative') throw new Error('registry_entity_create_forbidden');
  if (input.action === 'create' && current) throw new Error('entity_already_exists');
  if (input.action !== 'create' && !current) throw new Error('entity_not_found');

  const currentHash = current ? entityContentHash(input.entityKind, current) : null;
  if (input.action === 'create' && input.contentHash != null) throw new Error('stale_content');
  if (input.action !== 'create' && input.contentHash !== currentHash) throw new Error('stale_content');

  validateEvidence(input.evidence);
  const patch = normalizePatch(
    config,
    input.patch || {},
    input.action === 'create' ? config.creatable : config.mutable,
  );
  if (input.action === 'update' && Object.keys(patch).length === 0) throw new Error('empty_patch');
  if (input.action === 'confirm' && Object.keys(patch).length > 0) throw new Error('confirm_patch_not_empty');
  if (input.action === 'create') {
    for (const field of config.required) {
      if (patch[field] == null || patch[field] === '') throw new Error(`required_field_missing:${field}`);
    }
  }
  if (input.entityKind === 'opportunity') validateGroundedOpportunityPatch(patch, input.evidence);
  validatePatchEvidence(db, input.entityKind, patch, input.evidence);

  if (['opportunity', 'promotion'].includes(input.entityKind) && input.action !== 'confirm') {
    const merged = { ...(current || {}), ...patch };
    if (merged.precioMin != null && merged.precioMax != null && merged.precioMin > merged.precioMax) {
      throw new Error('invalid_price_range');
    }
  }
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 4000)) {
    throw new Error('invalid_notes');
  }
  return { config, current, currentHash, patch };
}

export function stageCurationReview(db, input) {
  const { currentHash, patch } = validateReviewInput(db, input);
  const id = `review-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const existing = db.prepare(
    "SELECT id FROM curation_reviews WHERE entityKind = ? AND entityId = ? AND status = 'staged'",
  ).get(input.entityKind, input.entityId);
  if (existing) {
    db.prepare(`UPDATE curation_reviews SET
      action=?,contentHash=?,patchJson=?,evidenceJson=?,notes=?,createdAt=? WHERE id=?`).run(
      input.action, currentHash, JSON.stringify(patch), JSON.stringify(input.evidence),
      input.notes || null, createdAt, existing.id,
    );
    return presentReview(db.prepare('SELECT * FROM curation_reviews WHERE id = ?').get(existing.id));
  }
  db.prepare(`INSERT INTO curation_reviews (
    id,entityKind,entityId,action,contentHash,patchJson,evidenceJson,notes,status,createdAt
  ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.entityKind, input.entityId, input.action, currentHash,
    JSON.stringify(patch), JSON.stringify(input.evidence), input.notes || null, 'staged', createdAt,
  );
  return presentReview(db.prepare('SELECT * FROM curation_reviews WHERE id = ?').get(id));
}

function sqlValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function logChangeEvents(db, entityKind, entityId, before, after) {
  const now = new Date().toISOString();
  if (before.status !== after.status) {
    db.prepare(`INSERT INTO events (detectedAt,entityKind,entityId,kind,label,oldValue,newValue)
      VALUES (?,?,?,?,?,?,?)`).run(now, entityKind, entityId, 'status', after.title || after.name || entityId, before.status, after.status);
  }
  if (entityKind === 'opportunity' && before.precioMin !== after.precioMin) {
    db.prepare(`INSERT INTO events (detectedAt,entityKind,entityId,kind,label,oldValue,newValue)
      VALUES (?,?,?,?,?,?,?)`).run(now, entityKind, entityId, 'price', after.title || entityId,
        before.precioMin == null ? null : String(before.precioMin),
        after.precioMin == null ? null : String(after.precioMin));
  }
}

export function applyStagedCurationReviews(db) {
  const rows = db.prepare(`SELECT * FROM curation_reviews WHERE status = 'staged'
    ORDER BY CASE entityKind WHEN 'gestora' THEN 0 WHEN 'opportunity' THEN 1 WHEN 'cooperative' THEN 2 WHEN 'promotion' THEN 3 ELSE 9 END,
             createdAt,id`).all();
  let applied = 0;
  let confirmed = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const evidence = parseJson(row.evidenceJson, []);
      const { config, current: before, patch } = validateReviewInput(db, {
        entityKind: row.entityKind,
        entityId: row.entityId,
        action: row.action,
        contentHash: row.contentHash,
        patch: parseJson(row.patchJson, {}),
        evidence,
        notes: row.notes,
      });
      if (row.action === 'create') {
        const record = { ...config.defaults, ...patch, [config.idField]: row.entityId };
        if (row.entityKind === 'opportunity') {
          const now = new Date().toISOString();
          record.firstSeenAt = now;
          record.lastSeenAt = now;
          record.source = new URL(record.url).hostname.replace(/^www\./, '');
          record.sourceKind = 'hermes-curator';
          record.evidenceText = evidence.map((item) => item.excerpt).join('\n').slice(0, 10_000);
        }
        if (row.entityKind === 'promotion') Object.assign(record, classifyPromotionLocation(record.location));
        const fields = Object.keys(record);
        db.prepare(`INSERT INTO ${config.table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
          .run(...fields.map((field) => sqlValue(record[field])));
        if (row.entityKind === 'opportunity') {
          db.prepare(`INSERT INTO sources (name,url,kind,ok,scanned,checkedAt)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(name) DO NOTHING`)
            .run(record.source, record.url, record.sourceKind, 1, 1, new Date().toISOString());
        }
        const after = getEntity(db, row.entityKind, row.entityId);
        db.prepare("UPDATE curation_reviews SET status='applied',resultHash=?,appliedAt=? WHERE id=?")
          .run(entityContentHash(row.entityKind, after), new Date().toISOString(), row.id);
        db.prepare(`INSERT INTO events (detectedAt,entityKind,entityId,kind,label,oldValue,newValue)
          VALUES (?,?,?,?,?,?,?)`).run(new Date().toISOString(), row.entityKind, row.entityId, 'discovered', after.title || after.name || row.entityId, null, after.location || after.website || null);
        applied += 1;
      } else if (row.action === 'update') {
        if (row.entityKind === 'opportunity') {
          const evidenceItems = parseJson(row.evidenceJson, []);
          const rebuiltEvidenceText = evidenceItems.map((item) => item.excerpt).join('\n').slice(0, 10_000);
          if (rebuiltEvidenceText) patch.evidenceText = rebuiltEvidenceText;
          patch.extractionMethod = 'hermes-curator';
          patch.enriched = 1;
        }
        if (row.entityKind === 'promotion' && Object.hasOwn(patch, 'location')) {
          Object.assign(patch, classifyPromotionLocation(patch.location));
        }
        const fields = Object.keys(patch);
        db.prepare(`UPDATE ${config.table} SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE ${config.idField} = ?`)
          .run(...fields.map((field) => sqlValue(patch[field])), row.entityId);
        const after = getEntity(db, row.entityKind, row.entityId);
        logChangeEvents(db, row.entityKind, row.entityId, before, after);
        const resultHash = entityContentHash(row.entityKind, after);
        db.prepare("UPDATE curation_reviews SET status='applied',resultHash=?,appliedAt=? WHERE id=?")
          .run(resultHash, new Date().toISOString(), row.id);
        applied += 1;
      } else {
        db.prepare("UPDATE curation_reviews SET status='applied',resultHash=?,appliedAt=? WHERE id=?")
          .run(row.contentHash, new Date().toISOString(), row.id);
        confirmed += 1;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { applied, confirmed };
}

export function listCurationReviews(db) {
  return db.prepare('SELECT * FROM curation_reviews ORDER BY createdAt DESC LIMIT 500').all().map(presentReview);
}

export function getCurationReview(db, id) {
  return presentReview(db.prepare('SELECT * FROM curation_reviews WHERE id = ?').get(id));
}

export function listOpportunitiesWithoutPrice(db) {
  return db.prepare(`
    SELECT * FROM opportunities
    WHERE precioMin IS NULL OR precioMax IS NULL
    ORDER BY COALESCE(publishedAt, firstSeenAt) DESC, id
    LIMIT 500
  `).all().map((record) => ({
    entityKind: 'opportunity',
    entityId: String(record.id),
    contentHash: entityContentHash('opportunity', record),
    record,
  }));
}
