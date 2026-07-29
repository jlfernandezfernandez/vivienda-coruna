import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('backend runtime image provides bash required by the pipeline runner', async () => {
  const dockerfile = await readFile(new URL('Dockerfile.backend', root), 'utf8');
  assert.match(dockerfile, /apk add[^\n]*\bbash\b/);
});

test('backend handles pipeline spawn errors without crashing', async () => {
  const server = await readFile(new URL('backend/server.mjs', root), 'utf8');
  assert.match(server, /child\.once\(['"]error['"]/);
});
