#!/usr/bin/env node
import { execSync } from 'node:child_process';

const COOLIFY_URL = (process.env.COOLIFY_URL || 'http://192.168.0.73:8000').replace(/\/$/, '');
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
if (!COOLIFY_TOKEN) {
  throw new Error('COOLIFY_TOKEN environment variable is required. Please set COOLIFY_TOKEN before running deploy-coolify.mjs.');
}
const SERVICE_UUID = process.env.COOLIFY_SERVICE_UUID || 'o4m4tfd2zgjiq38qqug43p4p';

function getGitCommitTag() {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    return `sha-${sha}`;
  } catch (error) {
    throw new Error(`Failed to get git commit SHA: ${error.message}`);
  }
}

const tag = process.argv[2] || process.env.IMAGE_TAG || getGitCommitTag();

console.log(`[coolify-deploy] Target Service: ${SERVICE_UUID}`);
console.log(`[coolify-deploy] Updating IMAGE_TAG to: ${tag}`);
console.log(`[coolify-deploy] Endpoint: ${COOLIFY_URL}`);

// 1. Update IMAGE_TAG environment variable in Coolify service
const envRes = await fetch(`${COOLIFY_URL}/api/v1/services/${SERVICE_UUID}/envs`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${COOLIFY_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    key: 'IMAGE_TAG',
    value: tag,
    is_literal: true,
  }),
});

if (!envRes.ok) {
  const body = await envRes.text();
  throw new Error(`Failed to update environment variable on Coolify (${envRes.status}): ${body}`);
}
console.log(`[coolify-deploy] Environment variable IMAGE_TAG updated successfully.`);

// 2. Queue service restart / deploy
let deployRes = await fetch(`${COOLIFY_URL}/api/v1/services/${SERVICE_UUID}/restart`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${COOLIFY_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

if (!deployRes.ok) {
  deployRes = await fetch(`${COOLIFY_URL}/api/v1/deploy?uuid=${SERVICE_UUID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

if (!deployRes.ok) {
  const body = await deployRes.text();
  throw new Error(`Failed to trigger service deployment on Coolify (${deployRes.status}): ${body}`);
}
console.log(`[coolify-deploy] Deployment queued on Coolify. Monitoring health checks...`);

// 3. Smoke tests with retry loop
const maxAttempts = 30;
const delayMs = 3000;
let backendReady = false;
let frontendReady = false;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  await new Promise((r) => setTimeout(r, delayMs));

  try {
    const healthRes = await fetch('https://vivienda-api.jordixlab.com/health', { signal: AbortSignal.timeout(4000) });
    if (healthRes.ok) {
      const health = await healthRes.json();
      if (health.version === tag) {
        backendReady = true;
      }
    }
  } catch {}

  try {
    const readyRes = await fetch('https://vivienda-api.jordixlab.com/ready', { signal: AbortSignal.timeout(4000) });
    if (readyRes.ok) {
      const ready = await readyRes.json();
      if (ready.status === 'ready') {
        backendReady = backendReady && true;
      }
    }
  } catch {}

  try {
    const frontRes = await fetch('https://vivienda.jordixlab.com/', { signal: AbortSignal.timeout(4000) });
    if (frontRes.ok) {
      const frontVer = frontRes.headers.get('x-app-version');
      if (frontVer === tag) {
        frontendReady = true;
      }
    }
  } catch {}

  if (backendReady && frontendReady) {
    console.log(`[coolify-deploy] Verified deployment at attempt ${attempt}!`);
    break;
  }
  process.stdout.write(`[coolify-deploy] Waiting for containers (attempt ${attempt}/${maxAttempts})...\r`);
}

if (!backendReady || !frontendReady) {
  console.error(`\n[coolify-deploy] Smoke tests timed out: backendReady=${backendReady}, frontendReady=${frontendReady}`);
  process.exit(1);
}

// 4. Verify map markers and diagnostics
const dashRes = await fetch('https://vivienda.jordixlab.com/api/promociones.geojson', { signal: AbortSignal.timeout(5000) });
const geo = await dashRes.json();
console.log(`\n[coolify-deploy] ✅ Deployment SUCCESSFUL`);
console.log(`[coolify-deploy] - App Version: ${tag}`);
console.log(`[coolify-deploy] - GeoJSON Features: ${geo.features?.length || 0}`);
console.log(`[coolify-deploy] - Production URL: https://vivienda.jordixlab.com/`);
console.log(`[coolify-deploy] - Backend API: https://vivienda-api.jordixlab.com/`);
