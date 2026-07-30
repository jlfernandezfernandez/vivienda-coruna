import { DatabaseSync } from 'node:sqlite';

import { applyStagedCurationReviews } from './lib/curation.mjs';
import { ensureSchema } from './lib/db.mjs';

const databasePath = process.env.DB_PATH;
if (!databasePath) throw new Error('DB_PATH is required');

const db = new DatabaseSync(databasePath);
try {
  db.exec('PRAGMA foreign_keys = ON;');
  ensureSchema(db);
  const result = applyStagedCurationReviews(db);
  console.log(`Curación aplicada: ${result.applied} cambios, ${result.confirmed} confirmaciones`);
} finally {
  db.close();
}
