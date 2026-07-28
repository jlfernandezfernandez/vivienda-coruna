#!/usr/bin/env node
// ── Idempotent database initializer ─────────────────────────────────────────
// Copies seed database only if the target does not exist, then verifies it.
// Usage: node scripts/init-database.mjs [--force]

import { existsSync, copyFileSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './lib/config.mjs';
import { ensureSchema } from './lib/db.mjs';

const force = process.argv.includes('--force');
const dbPath = process.env.DB_PATH || join(config.paths.root, 'src', 'data', 'monitor.db');
const seedPath = join(config.paths.root, 'src', 'data', 'monitor.db');

// If DB_PATH points elsewhere, look for seed in src/data/monitor.db
const seedSource = join(config.paths.root, 'src', 'data', 'monitor.db');

console.log(`[init-database] Target: ${dbPath}`);
console.log(`[init-database] Seed:   ${seedSource}`);

if (force && existsSync(dbPath)) {
  console.log('[init-database] --force: removing existing database');
  unlinkSync(dbPath);
}

if (!existsSync(dbPath)) {
  if (existsSync(seedSource)) {
    console.log('[init-database] Copying seed database...');
    const seedStat = statSync(seedSource);
    copyFileSync(seedSource, dbPath);
    const targetStat = statSync(dbPath);
    if (targetStat.size !== seedStat.size) {
      console.error('[init-database] ERROR: copy verification failed — size mismatch');
      process.exit(1);
    }
    console.log(`[init-database] Copied ${targetStat.size} bytes`);
  } else {
    console.log('[init-database] No seed found, creating empty database...');
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    ensureSchema(db);
    db.close();
    console.log('[init-database] Empty database created with full schema');
  }
} else {
  console.log('[init-database] Database already exists, skipping copy');
}

// ── Verify ──────────────────────────────────────────────────────────────────
console.log('[init-database] Verifying database...');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

// Check integrity
const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') {
  console.error(`[init-database] ERROR: integrity check failed: ${integrity.integrity_check}`);
  db.close();
  process.exit(1);
}

// Check that pipeline_runs table exists (our new schema)
const hasPipelineRuns = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_runs'").get();
if (!hasPipelineRuns) {
  console.log('[init-database] pipeline_runs table missing, applying schema...');
  ensureSchema(db);
  console.log('[init-database] Schema applied');
}

// Count tables
const tableCount = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
console.log(`[init-database] Tables: ${tableCount}`);

// Count rows
const oppCount = db.prepare('SELECT COUNT(*) n FROM opportunities').get().n;
const srcCount = db.prepare('SELECT COUNT(*) n FROM sources').get().n;
const gestCount = db.prepare('SELECT COUNT(*) n FROM gestoras').get().n;
const coopCount = db.prepare('SELECT COUNT(*) n FROM cooperatives WHERE active = 1').get().n;
const runCount = db.prepare('SELECT COUNT(*) n FROM pipeline_runs').get().n;
console.log(`[init-database] Rows — opportunities:${oppCount} sources:${srcCount} gestoras:${gestCount} cooperatives:${coopCount} runs:${runCount}`);

db.close();
console.log('[init-database] OK');
