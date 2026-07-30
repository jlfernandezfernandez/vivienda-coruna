import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';

const MIN_BYTES = 4096;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const MIN_ENTROPY = 0.05;
const FORMAT_BY_EXTENSION = Object.freeze({
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
});

export async function verifyReviewScreenshots(review, options = {}) {
  if (!Array.isArray(review?.evidence)) throw new Error('local_screenshot_required');
  const screenshots = review.evidence.flatMap((item) => item?.screenshot ? [item.screenshot] : []);
  if (screenshots.length === 0) throw new Error('local_screenshot_required');

  let dataRoot;
  try {
    dataRoot = realpathSync(resolve(
      options.dataRoot || process.env.HERMES_DATA_DIR || join(homedir(), '.hermes', 'data'),
    ));
  } catch {
    throw new Error('local_screenshot_root_not_found');
  }

  for (const screenshot of screenshots) {
    if (!screenshot || typeof screenshot.ref !== 'string' || typeof screenshot.sha256 !== 'string') {
      throw new Error('invalid_local_screenshot');
    }
    const requestedPath = resolve(dataRoot, screenshot.ref);
    if (!requestedPath.startsWith(`${dataRoot}${sep}`)) throw new Error('invalid_local_screenshot_path');

    let path;
    try { path = realpathSync(requestedPath); } catch { throw new Error('local_screenshot_not_found'); }
    if (!path.startsWith(`${dataRoot}${sep}`)) throw new Error('invalid_local_screenshot_path');

    const size = statSync(path).size;
    if (size < MIN_BYTES || size > MAX_BYTES) throw new Error('local_screenshot_not_credible');
    const buffer = readFileSync(path);
    if (buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) throw new Error('local_screenshot_not_credible');
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== screenshot.sha256.toLowerCase()) throw new Error('local_screenshot_hash_mismatch');

    let metadata;
    let stats;
    try {
      [metadata, stats] = await Promise.all([
        sharp(buffer, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata(),
        sharp(buffer, { failOn: 'error', limitInputPixels: 100_000_000 }).stats(),
      ]);
    } catch {
      throw new Error('local_screenshot_decode_failed');
    }
    const expectedFormat = FORMAT_BY_EXTENSION[extname(path).toLowerCase()];
    if (!expectedFormat || metadata.format !== expectedFormat
      || !metadata.width || !metadata.height
      || metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT
      || !Number.isFinite(stats.entropy) || stats.entropy < MIN_ENTROPY) {
      throw new Error('local_screenshot_not_credible');
    }
  }
}
