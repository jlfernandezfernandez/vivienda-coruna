import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createRun, ensureSchema } from '../scripts/lib/db.mjs';
import {
  applyStagedCurationReviews,
  listCurationCandidates,
  stageCurationReview,
} from '../scripts/lib/curation.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);
  db.prepare(`INSERT INTO opportunities (
    id,title,url,source,sourceKind,publishedAt,firstSeenAt,lastSeenAt,location,type,
    status,summary,enriched,extractionMethod
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'opp-1', 'Residencial Test', 'https://example.com/test', 'Prensa Test',
    'market-alert', '2026-07-28T10:00:00.000Z', '2026-07-28T11:00:00.000Z',
    '2026-07-28T11:00:00.000Z', 'A Coruña', 'Promoción nueva', null,
    'Promoción de 20 viviendas desde 210.000 euros.', 1, 'regex-no-llm',
  );
  return db;
}

const proof = (url, excerpt) => [{
  url,
  excerpt,
  screenshot: {
    ref: 'vivienda-curation/tests/evidence.png',
    sha256: '0'.repeat(64),
    capturedAt: new Date().toISOString(),
  },
}];

const evidence = proof(
  'https://example.com/test',
  'Promoción de 20 viviendas desde 210.000 euros.',
);

test('curation candidates include every entity never reviewed and expose a stable content hash', () => {
  const db = database();
  try {
    const candidates = listCurationCandidates(db);
    const opportunity = candidates.find((item) => item.entityKind === 'opportunity' && item.entityId === 'opp-1');
    assert.ok(opportunity);
    assert.match(opportunity.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(opportunity.record.title, 'Residencial Test');
  } finally {
    db.close();
  }
});

test('staged update requires current hash, allowed fields and source evidence', () => {
  const db = database();
  try {
    const candidate = listCurationCandidates(db).find((item) => item.entityId === 'opp-1');
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update',
      contentHash: '0'.repeat(64), patch: { precioMin: 210000 }, evidence,
    }), /stale_content/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update',
      contentHash: candidate.contentHash, patch: { id: 'hijack' }, evidence,
    }), /field_not_allowed/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update',
      contentHash: candidate.contentHash, patch: { promotora: 123 }, evidence,
    }), /invalid_field_type:promotora/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update',
      contentHash: candidate.contentHash, patch: { precioMin: 210000 }, evidence: [],
    }), /evidence_required/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update',
      contentHash: candidate.contentHash, patch: { precioMin: 999999 }, evidence,
    }), /ungrounded_field:precioMin/);
  } finally {
    db.close();
  }
});

test('applying staged reviews updates data, records provenance and removes unchanged entities from queue', () => {
  const db = database();
  try {
    const candidate = listCurationCandidates(db).find((item) => item.entityId === 'opp-1');
    const review = stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update',
      contentHash: candidate.contentHash,
      patch: { precioMin: 210000, totalViviendas: 20 },
      evidence,
      notes: 'Datos confirmados en la fuente primaria.',
    });
    assert.equal(review.status, 'staged');

    const result = applyStagedCurationReviews(db);
    assert.deepEqual(result, { applied: 1, confirmed: 0 });
    assert.equal(db.prepare('SELECT precioMin FROM opportunities WHERE id = ?').get('opp-1').precioMin, 210000);

    const stored = db.prepare('SELECT status,resultHash,evidenceJson FROM curation_reviews WHERE id = ?').get(review.id);
    assert.equal(stored.status, 'applied');
    assert.match(stored.resultHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(stored.evidenceJson), evidence);
    assert.equal(listCurationCandidates(db).some((item) => item.entityId === 'opp-1'), false);
  } finally {
    db.close();
  }
});

test('confirm reviews mark unchanged entities as reviewed without modifying their data', () => {
  const db = database();
  try {
    const candidate = listCurationCandidates(db).find((item) => item.entityId === 'opp-1');
    stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'confirm',
      contentHash: candidate.contentHash, patch: {}, evidence,
    });
    const result = applyStagedCurationReviews(db);
    assert.deepEqual(result, { applied: 0, confirmed: 1 });
    assert.equal(listCurationCandidates(db).some((item) => item.entityId === 'opp-1'), false);
    db.prepare('UPDATE opportunities SET lastSeenAt = ? WHERE id = ?').run('2026-07-30T12:00:00.000Z', 'opp-1');
    assert.equal(listCurationCandidates(db).some((item) => item.entityId === 'opp-1'), false);
  } finally {
    db.close();
  }
});

test('curation can add a missing gestora with evidence and does not queue it again unchanged', () => {
  const db = database();
  try {
    const review = stageCurationReview(db, {
      entityKind: 'gestora', entityId: 'gestora-nueva', action: 'create',
      patch: {
        name: 'Gestora Nueva', website: 'https://gestora.example',
      },
      evidence: proof('https://gestora.example', 'Gestora Nueva, gestora de cooperativas con sede en A Coruña.'),
    });
    assert.equal(review.status, 'staged');
    assert.deepEqual(applyStagedCurationReviews(db), { applied: 1, confirmed: 0 });
    assert.equal(db.prepare('SELECT name FROM gestoras WHERE id = ?').get('gestora-nueva').name, 'Gestora Nueva');
    assert.equal(listCurationCandidates(db).some((item) => item.entityId === 'gestora-nueva'), false);
  } finally {
    db.close();
  }
});

test('rejects unrelated evidence, nulls and inconsistent price ranges', () => {
  const db = database();
  try {
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'gestora', entityId: 'inventada', action: 'create',
      patch: { name: 'Gestora Inventada', website: 'https://example.com' },
      evidence: proof('https://example.com', 'Página sobre meteorología local.'),
    }), /ungrounded_field:name/);
    const candidate = listCurationCandidates(db).find((item) => item.entityId === 'opp-1');
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'confirm', contentHash: candidate.contentHash,
      evidence: [{ url: 'https://example.com/test', excerpt: 'Residencial Test en A Coruña.' }],
    }), /screenshot_required/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'confirm', contentHash: candidate.contentHash,
      evidence: [{
        url: 'https://example.com/test', excerpt: 'Residencial Test en A Coruña.',
        screenshot: { ref: '../escape.png', sha256: '0'.repeat(64), capturedAt: new Date().toISOString() },
      }],
    }), /invalid_screenshot_evidence/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'confirm', contentHash: candidate.contentHash,
      evidence: [{
        url: 'https://example.com/test', excerpt: 'Residencial Test en A Coruña.',
        screenshot: { ref: 'vivienda-curation/tests/evidence.png', sha256: '0'.repeat(64), capturedAt: '2026-02-30T12:00:00.000Z' },
      }],
    }), /invalid_screenshot_evidence/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update', contentHash: candidate.contentHash,
      patch: { location: null }, evidence,
    }), /null_not_allowed:location/);
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update', contentHash: candidate.contentHash,
      patch: { type: 'Categoría inventada' },
      evidence: proof('https://example.com/test', 'Categoría inventada.'),
    }), /invalid_enum:type/);
    db.prepare('UPDATE opportunities SET precioMax=? WHERE id=?').run(200000, 'opp-1');
    const priceCandidate = listCurationCandidates(db).find((item) => item.entityId === 'opp-1');
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'update', contentHash: priceCandidate.contentHash,
      patch: { precioMin: 300000 },
      evidence: proof('https://example.com/test', 'Precio mínimo 300.000 euros.'),
    }), /invalid_price_range/);
  } finally {
    db.close();
  }
});

test('creates gestora before its dependent promotion and validates the relationship evidence', () => {
  const db = database();
  try {
    assert.throws(() => stageCurationReview(db, {
      entityKind: 'promotion', entityId: 'promo-invalida', action: 'create',
      patch: { gestoraId: 'missing', name: 'Residencial Falso', location: 'A Coruña', status: 'Comercialización' },
      evidence: proof('https://example.com/promo', 'Missing presenta Residencial Falso en A Coruña, Comercialización.'),
    }), /ungrounded_field:gestoraId/);
    stageCurationReview(db, {
      entityKind: 'gestora', entityId: 'gestora-dependencia', action: 'create',
      patch: { name: 'Gestora Dependencia', website: 'https://gestora.example' },
      evidence: proof('https://gestora.example', 'Gestora Dependencia, sitio oficial.'),
    });
    stageCurationReview(db, {
      entityKind: 'promotion', entityId: 'promo-dependencia', action: 'create',
      patch: { gestoraId: 'gestora-dependencia', name: 'Residencial Dependencia', location: 'A Coruña', status: 'Comercialización' },
      evidence: proof('https://gestora.example/promocion', 'Gestora Dependencia presenta Residencial Dependencia en A Coruña. Comercialización.'),
    });
    assert.deepEqual(applyStagedCurationReviews(db), { applied: 2, confirmed: 0 });
    assert.equal(db.prepare('SELECT gestoraId FROM gestora_promotions WHERE id=?').get('promo-dependencia').gestoraId, 'gestora-dependencia');
  } finally {
    db.close();
  }
});

test('curated opportunities do not overwrite an existing source definition', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO sources (name,url,kind,ok,scanned,checkedAt) VALUES (?,?,?,?,?,?)')
      .run('example.com', 'https://example.com/feed.xml', 'official', 1, 1, new Date().toISOString());
    stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-created', action: 'create',
      patch: { title: 'Residencial Creado', url: 'https://example.com/noticia', location: 'A Coruña' },
      evidence: proof('https://example.com/noticia', 'Residencial Creado es una promoción situada en A Coruña.'),
    });
    applyStagedCurationReviews(db);
    assert.equal(db.prepare('SELECT url FROM sources WHERE name=?').get('example.com').url, 'https://example.com/feed.xml');
  } finally {
    db.close();
  }
});

test('apply rejects a corrupted confirm patch atomically', () => {
  const db = database();
  try {
    const candidate = listCurationCandidates(db).find((item) => item.entityId === 'opp-1');
    const review = stageCurationReview(db, {
      entityKind: 'opportunity', entityId: 'opp-1', action: 'confirm',
      contentHash: candidate.contentHash,
      evidence: proof('https://example.com/opp-1', 'Residencial Uno está en A Coruña.'),
    });
    db.prepare('UPDATE curation_reviews SET patchJson=? WHERE id=?').run('{"location":"Arteixo"}', review.id);
    assert.throws(() => applyStagedCurationReviews(db), /confirm_patch_not_empty/);
    assert.equal(db.prepare('SELECT location FROM opportunities WHERE id=?').get('opp-1').location, 'A Coruña');
    assert.equal(db.prepare('SELECT status FROM curation_reviews WHERE id=?').get(review.id).status, 'staged');
  } finally { db.close(); }
});

test('apply rejects a corrupted create missing required fields', () => {
  const db = database();
  try {
    const review = stageCurationReview(db, {
      entityKind: 'gestora', entityId: 'gestora-incompleta', action: 'create',
      patch: { name: 'Gestora Incompleta', website: 'https://gestora.example/' },
      evidence: proof('https://gestora.example/', 'Gestora Incompleta.'),
    });
    db.prepare('UPDATE curation_reviews SET patchJson=? WHERE id=?')
      .run('{"website":"https://gestora.example/"}', review.id);
    assert.throws(() => applyStagedCurationReviews(db), /required_field_missing:name/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gestoras WHERE id=?').get('gestora-incompleta').n, 0);
  } finally { db.close(); }
});

test('promotion resolves a gestora name updated in the same batch', () => {
  const db = database();
  try {
    db.prepare(`INSERT INTO gestoras (id,name,logo,website,phone,email,address,description)
      VALUES (?,?,?,?,?,?,?,?)`).run('gestora-rename', 'Nombre Antiguo', '', 'https://nova.test/', '', '', '', '');
    const hash = listCurationCandidates(db).find((x) => x.entityId === 'gestora-rename').contentHash;
    stageCurationReview(db, {
      entityKind: 'gestora', entityId: 'gestora-rename', action: 'update', contentHash: hash,
      patch: { name: 'Nova Gestora' },
      evidence: proof('https://nova.test/', 'Nova Gestora.'),
    });
    stageCurationReview(db, {
      entityKind: 'promotion', entityId: 'promo-rename', action: 'create',
      patch: { gestoraId: 'gestora-rename', name: 'Residencial Nova', location: 'A Coruña', status: 'Comercialización' },
      evidence: proof('https://nova.test/residencial', 'Nova Gestora presenta Residencial Nova en A Coruña. Comercialización.'),
    });
    applyStagedCurationReviews(db);
    assert.equal(db.prepare('SELECT name FROM gestoras WHERE id=?').get('gestora-rename').name, 'Nova Gestora');
    assert.equal(db.prepare('SELECT gestoraId FROM gestora_promotions WHERE id=?').get('promo-rename').gestoraId, 'gestora-rename');
  } finally { db.close(); }
});

test('schema migration preserves old pipeline runs and enables curate mode', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE pipeline_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('fast','deep')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
        idempotencyKey TEXT, createdAt TEXT NOT NULL, startedAt TEXT, completedAt TEXT, error TEXT
      );
      INSERT INTO pipeline_runs (id,mode,status,createdAt) VALUES ('old-run','fast','succeeded','2026-07-01T00:00:00.000Z');
    `);
    ensureSchema(db);
    assert.equal(db.prepare('SELECT mode FROM pipeline_runs WHERE id = ?').get('old-run').mode, 'fast');
    assert.equal(createRun(db, 'curate', 'curate-migration-test').mode, 'curate');
  } finally {
    db.close();
  }
});
