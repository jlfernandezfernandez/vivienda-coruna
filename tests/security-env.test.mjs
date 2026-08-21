import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

function runDeployScript(args = [], envOverrides = {}, { inheritEnv = true } = {}) {
  return new Promise((resolve) => {
    const scriptPath = join(import.meta.dirname, '../scripts/deploy-coolify.mjs');
    const child = spawn('node', [scriptPath, ...args], {
      env: inheritEnv ? { ...process.env, ...envOverrides } : envOverrides,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

function createMockCoolifyServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      });

      res.setHeader('Connection', 'close');
      if (req.url.includes('/envs')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url.includes('/restart') || req.url.includes('/deploy')) {
        // Return 500 so deploy-coolify.mjs exits immediately without entering 90s smoke test loop
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Deployment queued simulation exit');
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        requests,
        close: () => {
          server.closeAllConnections?.();
          return new Promise((res) => server.close(res));
        },
      });
    });
    server.on('error', reject);
  });
}

// ── TIER 1: Category-Partition Tests ────────────────────────────────────────

test('Tier 1: deploy-coolify.mjs requires COOLIFY_TOKEN environment variable', async () => {
  const result = await runDeployScript([], { COOLIFY_TOKEN: '' });

  assert.notEqual(result.exitCode, 0, 'Script must fail when COOLIFY_TOKEN is empty');
  assert.match(
    result.stderr + result.stdout,
    /COOLIFY_TOKEN environment variable is required/,
    'Error message must indicate COOLIFY_TOKEN is required'
  );
});

test('Tier 1: deploy-coolify.mjs throws immediately when COOLIFY_TOKEN is unset in environment', async () => {
  const envWithoutToken = { ...process.env };
  delete envWithoutToken.COOLIFY_TOKEN;

  const result = await runDeployScript([], envWithoutToken, { inheritEnv: false });

  assert.notEqual(result.exitCode, 0, 'Script must fail when COOLIFY_TOKEN is unset');
  assert.match(
    result.stderr + result.stdout,
    /COOLIFY_TOKEN environment variable is required/
  );
});

// ── TIER 2: Boundary & Corner Cases ──────────────────────────────────────────

test('Tier 2: deploy-coolify.mjs static analysis: zero hardcoded secrets or API tokens', () => {
  const scriptPath = join(import.meta.dirname, '../scripts/deploy-coolify.mjs');
  const content = readFileSync(scriptPath, 'utf8');

  // Verify no literal bearer token string exists in code
  assert.doesNotMatch(
    content,
    /Authorization:\s*['"`]Bearer\s+[0-9a-zA-Z._-]+['"`]/,
    'No static Bearer token string should be hardcoded'
  );

  // Verify COOLIFY_TOKEN assignment strictly uses process.env
  assert.match(
    content,
    /const\s+COOLIFY_TOKEN\s*=\s*process\.env\.COOLIFY_TOKEN;/,
    'COOLIFY_TOKEN must be read from process.env.COOLIFY_TOKEN'
  );

  // Verify guard check exists
  assert.match(
    content,
    /if\s*\(!COOLIFY_TOKEN\)\s*\{\s*throw new Error\(/,
    'Guard clause checking !COOLIFY_TOKEN must be present'
  );
});

test('Tier 2: deploy-coolify.mjs accepts configurable COOLIFY_URL and COOLIFY_SERVICE_UUID from environment', () => {
  const scriptPath = join(import.meta.dirname, '../scripts/deploy-coolify.mjs');
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(
    content,
    /process\.env\.COOLIFY_URL/,
    'COOLIFY_URL must support environment variable configuration'
  );
  assert.match(
    content,
    /process\.env\.COOLIFY_SERVICE_UUID/,
    'COOLIFY_SERVICE_UUID must support environment variable configuration'
  );
});

// ── TIER 3: Cross-Feature Combinations ──────────────────────────────────────

test('Tier 3: deploy-coolify.mjs authenticates API requests with Bearer header and patches IMAGE_TAG', async () => {
  const mockServer = await createMockCoolifyServer();
  const customServiceUuid = 'srv-test-123456';
  const customTag = 'sha-test-abcdef123';
  const testToken = 'coolify_sec_test_token_987654';

  try {
    await runDeployScript([customTag], {
      COOLIFY_URL: mockServer.baseUrl,
      COOLIFY_TOKEN: testToken,
      COOLIFY_SERVICE_UUID: customServiceUuid,
      IMAGE_TAG: customTag,
    });

    // Verify PATCH env call
    const patchReq = mockServer.requests.find((r) => r.method === 'PATCH' && r.url.includes('/envs'));
    assert.ok(patchReq, 'Must send PATCH request to update service envs');
    assert.equal(patchReq.headers.authorization, `Bearer ${testToken}`, 'Must include Authorization Bearer header');
    assert.equal(patchReq.url, `/api/v1/services/${customServiceUuid}/envs`);
    assert.deepEqual(patchReq.body, {
      key: 'IMAGE_TAG',
      value: customTag,
      is_literal: true,
    });

    // Verify restart/deploy call
    const deployReq = mockServer.requests.find((r) => r.method === 'POST' && (r.url.includes('/restart') || r.url.includes('/deploy')));
    assert.ok(deployReq, 'Must send POST request to restart or deploy service');
    assert.equal(deployReq.headers.authorization, `Bearer ${testToken}`);
  } finally {
    await mockServer.close();
  }
});

// ── TIER 4: Real-World Scenarios ─────────────────────────────────────────────

test('Tier 4: deploy-coolify.mjs reports descriptive error when Coolify API rejects credentials (401 Unauthorized)', async () => {
  const unauthorizedServer = await new Promise((resolve, reject) => {
    const s = http.createServer((_req, res) => {
      res.setHeader('Connection', 'close');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthenticated.' }));
    });
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => {
          s.closeAllConnections?.();
          return new Promise((res) => s.close(res));
        },
      });
    });
    s.on('error', reject);
  });

  try {
    const result = await runDeployScript(['sha-test'], {
      COOLIFY_URL: unauthorizedServer.baseUrl,
      COOLIFY_TOKEN: 'invalid-token',
    });

    assert.notEqual(result.exitCode, 0, 'Script must fail with non-zero exit code on 401');
    assert.match(
      result.stderr + result.stdout,
      /Failed to update environment variable on Coolify \(401\)/,
      'Error message must state HTTP 401 response from Coolify'
    );
  } finally {
    await unauthorizedServer.close();
  }
});
