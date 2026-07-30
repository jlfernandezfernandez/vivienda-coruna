import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { ensureSchema } from '../scripts/lib/db.mjs';
import { verifyReviewScreenshots } from '../scripts/lib/screenshot-proof.mjs';

function review(ref, buffer, dataRoot) {
  const path = join(dataRoot, ref);
  mkdirSync(join(dataRoot, 'vivienda-curation', 'tests'), { recursive: true });
  writeFileSync(path, buffer);
  return {
    evidence: [{
      screenshot: { ref, sha256: createHash('sha256').update(buffer).digest('hex') },
    }],
  };
}

async function screenshotPng(width = 1280, height = 720) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x % 256;
      pixels[offset + 1] = y % 256;
      pixels[offset + 2] = (x + y) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test('local screenshot verification decodes and accepts a credible PNG', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'vivienda-proof-'));
  const buffer = await screenshotPng();
  await assert.doesNotReject(() => verifyReviewScreenshots(
    review('vivienda-curation/tests/real.png', buffer, dataRoot), { dataRoot },
  ));
});

test('local screenshot verification rejects 1x1 placeholders and hash mismatches', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'vivienda-proof-'));
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(() => verifyReviewScreenshots(
    review('vivienda-curation/tests/tiny.png', tiny, dataRoot), { dataRoot },
  ), /local_screenshot_not_credible/);
  const valid = review('vivienda-curation/tests/hash.png', await screenshotPng(), dataRoot);
  valid.evidence[0].screenshot.sha256 = '0'.repeat(64);
  await assert.rejects(() => verifyReviewScreenshots(valid, { dataRoot }), /local_screenshot_hash_mismatch/);
});

test('local screenshot verification rejects forged headers, solid placeholders and symlink escapes', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'vivienda-proof-'));
  const forged = Buffer.alloc(5000);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(forged, 0);
  forged.writeUInt32BE(13, 8);
  forged.write('IHDR', 12, 'ascii');
  forged.writeUInt32BE(1280, 16);
  forged.writeUInt32BE(720, 20);
  await assert.rejects(() => verifyReviewScreenshots(
    review('vivienda-curation/tests/forged.png', forged, dataRoot), { dataRoot },
  ), /local_screenshot_decode_failed/);

  const solid = await sharp({ create: { width: 1280, height: 720, channels: 3, background: 'white' } })
    .png({ compressionLevel: 0 }).toBuffer();
  await assert.rejects(() => verifyReviewScreenshots(
    review('vivienda-curation/tests/solid.png', solid, dataRoot), { dataRoot },
  ), /local_screenshot_not_credible/);

  const outside = mkdtempSync(join(tmpdir(), 'vivienda-outside-'));
  const outsideFile = join(outside, 'outside.png');
  const valid = await screenshotPng();
  writeFileSync(outsideFile, valid);
  mkdirSync(join(dataRoot, 'vivienda-curation'), { recursive: true });
  symlinkSync(outsideFile, join(dataRoot, 'vivienda-curation', 'linked.png'));
  await assert.rejects(() => verifyReviewScreenshots({ evidence: [{ screenshot: {
    ref: 'vivienda-curation/linked.png', sha256: createHash('sha256').update(valid).digest('hex'),
  } }] }, { dataRoot }), /invalid_local_screenshot_path/);
});

test('local screenshot verification rejects missing and escaping files', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'vivienda-proof-'));
  await assert.rejects(() => verifyReviewScreenshots({ evidence: [] }, { dataRoot }), /local_screenshot_required/);
  await assert.rejects(() => verifyReviewScreenshots({
    evidence: [{ screenshot: { ref: '../escape.png', sha256: '0'.repeat(64) } }],
  }, { dataRoot }), /invalid_local_screenshot_path/);
  await assert.rejects(() => verifyReviewScreenshots({
    evidence: [{ screenshot: { ref: 'vivienda-curation/tests/missing.png', sha256: '0'.repeat(64) } }],
  }, { dataRoot }), /local_screenshot_not_found/);
});

test('schema invalidates the known placeholder screenshot batch without deleting audit rows', () => {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  const placeholderHash = 'e878950f8091ec010cf5cc723bdea027a8539cf7147cfea199c2f666232dcd4e';
  db.prepare(`INSERT INTO curation_reviews (
    id,entityKind,entityId,action,contentHash,resultHash,patchJson,evidenceJson,status,createdAt,appliedAt
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    'review-placeholder', 'gestora', 'gestora-test', 'confirm', 'a', 'b', '{}',
    JSON.stringify([{ screenshot: { sha256: placeholderHash } }]), 'applied',
    '2026-07-30T12:00:00.000Z', '2026-07-30T12:01:00.000Z',
  );
  db.prepare(`INSERT INTO curation_reviews (
    id,entityKind,entityId,action,contentHash,resultHash,patchJson,evidenceJson,status,createdAt,appliedAt
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    'review-unrelated-hash', 'gestora', 'gestora-safe', 'confirm', 'c', 'd', '{}',
    JSON.stringify([{ url: `https://example.com/${placeholderHash}`, screenshot: { sha256: '1'.repeat(64) } }]),
    'applied', '2026-07-30T12:00:00.000Z', '2026-07-30T12:01:00.000Z',
  );
  for (const [id, evidenceJson] of [
    ['review-malformed-json', '{'],
    ['review-string-element', JSON.stringify(['not-an-object'])],
    ['review-object-root', JSON.stringify({ screenshot: { sha256: placeholderHash } })],
  ]) {
    db.prepare(`INSERT INTO curation_reviews (
      id,entityKind,entityId,action,contentHash,resultHash,patchJson,evidenceJson,status,createdAt,appliedAt
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, 'gestora', id, 'confirm', id, id, '{}', evidenceJson,
      'applied', '2026-07-30T12:00:00.000Z', '2026-07-30T12:01:00.000Z',
    );
  }

  ensureSchema(db);
  const row = db.prepare('SELECT status,notes FROM curation_reviews WHERE id = ?').get('review-placeholder');
  assert.equal(row.status, 'conflict');
  assert.match(row.notes, /placeholder screenshot detected/);
  assert.equal(db.prepare('SELECT status FROM curation_reviews WHERE id = ?').get('review-unrelated-hash').status, 'applied');
  assert.deepEqual(
    db.prepare(`SELECT status FROM curation_reviews WHERE id LIKE 'review-%json' OR id LIKE 'review-%element' OR id = 'review-object-root' ORDER BY id`).all().map((item) => item.status),
    ['applied', 'applied', 'applied'],
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM curation_reviews').get().n, 5);
});
