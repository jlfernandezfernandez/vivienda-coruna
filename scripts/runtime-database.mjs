import { renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureSchema, getRunById, transitionRun } from './lib/db.mjs';

const [command, databasePath, runId, extra] = process.argv.slice(2);

if (!command || !databasePath) {
  console.error('usage: runtime-database.mjs <command> <database> [run-id] [extra]');
  process.exit(64);
}

function open(path = databasePath) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

if (command === 'snapshot') {
  if (!runId) process.exit(64);
  rmSync(runId, { force: true });
  const db = open();
  try {
    db.exec(`VACUUM INTO ${quoteSqlLiteral(runId)}`);
  } finally {
    db.close();
  }
  process.exit(0);
}

if (command === 'promote') {
  if (!runId) process.exit(64);
  renameSync(databasePath, runId);
  process.exit(0);
}

const db = open();
try {
  ensureSchema(db);
  if (command === 'start') {
    if (!getRunById(db, runId) || !transitionRun(db, runId, 'queued', 'running')) process.exitCode = 65;
  } else if (command === 'succeed') {
    if (!transitionRun(db, runId, 'running', 'succeeded')) process.exitCode = 65;
  } else if (command === 'fail') {
    const failed = transitionRun(db, runId, 'running', 'failed');
    if (failed && extra) {
      db.prepare('UPDATE pipeline_runs SET error = ? WHERE id = ?').run(extra.slice(0, 2000), runId);
    }
  } else if (command === 'check') {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (integrity !== 'ok' || foreignKeys.length > 0) process.exitCode = 66;
  } else {
    process.exitCode = 64;
  }
} finally {
  db.close();
}
