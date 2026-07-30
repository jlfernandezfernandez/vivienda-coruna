#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const baseUrl = 'https://vivienda-api.jordixlab.com';
const keyPath = process.env.VIVIENDA_OPERATIONS_KEY_FILE || join(homedir(), '.hermes', 'secrets', 'vivienda_operations_key');
const token = readFileSync(keyPath, 'utf8').trim();
if (!token) throw new Error('operations key file is empty');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function output(body, path) {
  const json = `${JSON.stringify(body, null, 2)}\n`;
  if (path) {
    writeFileSync(path, json, { mode: 0o600 });
    const count = body.candidates?.length ?? body.reviews?.length;
    console.log(JSON.stringify({ savedTo: path, count }));
  } else {
    process.stdout.write(json);
  }
}

const [command, argument] = process.argv.slice(2);
if (!command) {
  console.error('usage: curator-client.mjs candidates|reviews|stage|deep|commit|runs|run|wait|diagnostics [argument]');
  process.exit(64);
}

if (command === 'candidates') {
  output(await request('/api/v1/operations/curation/candidates'), argument);
} else if (command === 'reviews') {
  output(await request('/api/v1/operations/curation/reviews'), argument);
} else if (command === 'stage') {
  if (!argument) throw new Error('stage requires a JSON file');
  const review = JSON.parse(readFileSync(argument, 'utf8'));
  output(await request('/api/v1/operations/curation/reviews', { method: 'POST', body: JSON.stringify(review) }));
} else if (command === 'deep') {
  const idempotencyKey = argument || `deep-curator-${new Date().toISOString()}`;
  output(await request('/api/v1/operations/runs', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ mode: 'deep' }),
  }));
} else if (command === 'commit') {
  const idempotencyKey = argument || `curation-${new Date().toISOString()}`;
  output(await request('/api/v1/operations/runs', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ mode: 'curate' }),
  }));
} else if (command === 'runs') {
  output(await request('/api/v1/operations/runs'), argument);
} else if (command === 'run') {
  if (!argument) throw new Error('run requires a run id');
  output(await request(`/api/v1/operations/runs/${encodeURIComponent(argument)}`));
} else if (command === 'wait') {
  if (!argument) throw new Error('wait requires a run id');
  const deadline = Date.now() + 20 * 60_000;
  let run;
  do {
    run = await request(`/api/v1/operations/runs/${encodeURIComponent(argument)}`);
    if (['succeeded', 'failed', 'interrupted'].includes(run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (Date.now() < deadline);
  if (!run || !['succeeded', 'failed', 'interrupted'].includes(run.status)) throw new Error('curation run timed out');
  output(run);
  if (run.status !== 'succeeded') process.exitCode = 1;
} else if (command === 'diagnostics') {
  output(await request('/api/v1/operations/diagnostics'));
} else {
  throw new Error(`unknown command: ${command}`);
}
