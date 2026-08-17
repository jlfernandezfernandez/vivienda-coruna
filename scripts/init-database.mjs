import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backfillGeocoding, ensureSchema } from './lib/db.mjs';

const target = resolve(process.env.DB_PATH || process.argv[2] || '/data/monitor.db');
const seed = resolve(process.env.SEED_DATABASE_PATH || process.argv[3] || '/app/seed/monitor.db');

mkdirSync(dirname(target), { recursive: true });
if (!existsSync(target)) {
  if (!existsSync(seed)) throw new Error(`Seed database not found: ${seed}`);
  copyFileSync(seed, target);
  console.log(`Seed database copied to ${target}`);
}

const db = new DatabaseSync(target);
try {
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  backfillGeocoding(db);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  if (integrity !== 'ok' || foreignKeys.length > 0) {
    throw new Error(`Database verification failed: integrity=${integrity}, foreignKeys=${foreignKeys.length}`);
  }
} finally {
  db.close();
}
console.log(`Database ready at ${target}`);
