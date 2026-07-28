import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production compose names roles clearly and isolates the SQLite volume', () => {
  const compose = read('compose.production.yml');
  assert.match(compose, /^  database-init:/m);
  assert.match(compose, /^  backend:/m);
  assert.match(compose, /^  frontend:/m);
  assert.match(compose, /^  vivienda_database:/m);

  const frontend = compose.split(/^  frontend:/m)[1].split(/^volumes:/m)[0];
  assert.doesNotMatch(frontend, /vivienda_database|DB_PATH|DATABASE_PATH/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
});

test('production images are immutable and required by tag', () => {
  const compose = read('compose.production.yml');
  assert.match(compose, /vivienda-coruna-backend:\$\{IMAGE_TAG:\?\}/);
  assert.match(compose, /vivienda-coruna-frontend:\$\{IMAGE_TAG:\?\}/);
  assert.doesNotMatch(compose, /:latest\b/);
});

test('containers expose separate readiness checks', () => {
  const backend = read('Dockerfile.backend');
  const frontend = read('Dockerfile.frontend');
  assert.match(backend, /\/ready/);
  assert.match(frontend, /127\.0\.0\.1:4321/);
});
