import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url).pathname;

test('getDatabase uses DB_PATH so production can persist SQLite in a volume', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vivienda-db-path-'));
  const databasePath = join(directory, 'monitor.db');

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { getDatabase } from './scripts/lib/db.mjs'; const db = getDatabase(); db.prepare('SELECT 1').get(); db.close();",
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, DB_PATH: databasePath },
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(databasePath), true, 'DB_PATH should contain the created SQLite database');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
