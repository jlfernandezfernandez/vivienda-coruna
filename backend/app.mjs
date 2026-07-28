import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';

function authorized(header, expectedToken) {
  if (!expectedToken || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const VALID_MODES = new Set(['fast', 'deep']);

export function buildBackend({ repository, operationsApiKey, logger = false }) {
  const app = Fastify({ logger });

  // ── Public contracts (no auth) ──────────────────────────────────────────

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    try {
      return { status: 'ready', ...repository.health() };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/api/v1/dashboard', async () => repository.dashboard());

  app.get('/api/v1/opportunities/:id', async (request, reply) => {
    const opportunity = repository.opportunityById(request.params.id);
    return opportunity ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/gestoras', async () => repository.gestoras());

  app.get('/gestoras/:id', async (request, reply) => {
    const gestora = repository.gestoraById(request.params.id);
    return gestora ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/cooperatives', async () => repository.cooperatives());

  app.get('/municipalities/:slug', async (request, reply) => {
    const municipality = repository.municipalityBySlug(request.params.slug);
    return municipality ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/seo/routes', async () => repository.seoRoutes());

  // ── Operational endpoints (Bearer auth) ─────────────────────────────────

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/operations/')) return;
    if (!authorized(request.headers.authorization, operationsApiKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/v1/operations/diagnostics', async () => ({
    status: 'ok',
    ...repository.diagnostics(),
  }));

  app.post('/api/v1/operations/runs', async (request, reply) => {
    const { mode } = request.body || {};
    if (!VALID_MODES.has(mode)) {
      return reply.code(400).send({ error: 'invalid_mode', valid: [...VALID_MODES] });
    }
    const idempotencyKey = request.headers['idempotency-key'] || null;
    const run = repository.createRun(mode, idempotencyKey);
    return reply
      .code(202)
      .header('location', `/api/v1/operations/runs/${run.id}`)
      .send(run);
  });

  app.get('/api/v1/operations/runs', async () => repository.listRuns());

  app.get('/api/v1/operations/runs/:id', async (request, reply) => {
    const run = repository.runById(request.params.id);
    return run ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v1/operations/sources', async () => repository.sources());

  return app;
}
