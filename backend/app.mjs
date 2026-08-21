import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';

const VALID_MODES = new Set(['fast', 'deep', 'curate']);

function authorized(header, expectedToken) {
  if (!expectedToken || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function buildBackend({
  repository,
  operationsApiKey,
  onRunCreated = () => {},
  appVersion = process.env.APP_VERSION || 'development',
  logger = false,
}) {
  const app = Fastify({ logger, bodyLimit: 8 * 1024 });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/operations/')) return;
    if (!authorized(request.headers.authorization, operationsApiKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ status: 'ok', version: appVersion }));

  app.get('/ready', async (_request, reply) => {
    try {
      return { status: 'ready', ...repository.health() };
    } catch (error) {
      console.error('readiness check failed:', error.message);
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/api/v1/dashboard', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    return repository.dashboard();
  });

  app.get('/api/v1/opportunities/:id', async (request, reply) => {
    const opportunity = repository.opportunityById(request.params.id);
    return opportunity ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v1/gestoras', async () => repository.gestoras());

  app.get('/api/v1/gestoras/:id', async (request, reply) => {
    const gestora = repository.gestoraById(request.params.id);
    return gestora ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v1/cooperatives', async () => repository.cooperatives());

  app.get('/api/v1/municipalities/:slug', async (request, reply) => {
    const municipality = repository.municipalityBySlug(request.params.slug);
    return municipality ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v1/seo/routes', async () => repository.seoRoutes());

  app.get('/api/v1/operations/diagnostics', async () => ({
    status: 'ok',
    ...repository.diagnostics(),
  }));

  app.post('/api/v1/operations/runs', async (request, reply) => {
    const { mode } = request.body || {};
    if (!VALID_MODES.has(mode)) {
      return reply.code(400).send({ error: 'invalid_mode', valid: [...VALID_MODES] });
    }

    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return reply.code(400).send({ error: 'idempotency_key_required' });
    }

    const existing = repository.runByIdempotencyKey?.(idempotencyKey);
    if (existing) {
      if (existing.mode !== mode) return reply.code(409).send({ error: 'idempotency_key_mode_mismatch' });
      return reply.code(202).header('location', `/api/v1/operations/runs/${existing.id}`).send(existing);
    }
    const active = repository.activeRun?.();
    if (active) return reply.code(409).send({ error: 'operation_in_progress', runId: active.id });
    if (mode === 'curate') {
      const pending = repository.curationCandidates().length;
      if (pending > 0) return reply.code(409).send({ error: 'curation_incomplete', pending });
      if (!repository.hasStagedCurationReviews()) return reply.code(409).send({ error: 'nothing_to_curate' });
    } else if (repository.hasStagedCurationReviews?.()) {
      return reply.code(409).send({ error: 'curation_in_progress' });
    }

    const run = repository.createRun(mode, idempotencyKey);
    queueMicrotask(() => onRunCreated(run));
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

  app.get('/api/v1/operations/curation/candidates', async () => ({
    generatedAt: new Date().toISOString(),
    candidates: repository.curationCandidates(),
  }));

  app.get('/api/v1/operations/curation/reviews', async () => ({
    reviews: repository.curationReviews(),
  }));

  app.get('/api/v1/operations/curation/reviews/:id', async (request, reply) => {
    const review = repository.curationReviewById(request.params.id);
    return review ?? reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v1/operations/curation/opportunities-without-price', async () => ({
    generatedAt: new Date().toISOString(),
    opportunities: repository.opportunitiesWithoutPrice(),
  }));

  app.post('/api/v1/operations/curation/reviews', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (repository.activeRun?.()) return reply.code(409).send({ error: 'operation_in_progress' });
    try {
      return reply.code(201).send(repository.stageCurationReview(request.body || {}));
    } catch (error) {
      const code = String(error.message).split(':')[0];
      if (['stale_content', 'review_already_staged', 'entity_already_exists'].includes(code)) {
        return reply.code(409).send({ error: code });
      }
      if (code === 'entity_not_found') return reply.code(404).send({ error: code });
      const safeValidationErrors = new Set([
        'invalid_entity_kind', 'invalid_action', 'entity_id_required', 'registry_entity_create_forbidden',
        'content_hash_required', 'evidence_required', 'invalid_evidence_url', 'invalid_evidence_excerpt',
        'screenshot_required', 'invalid_screenshot_evidence',
        'invalid_patch', 'field_not_allowed', 'null_not_allowed', 'invalid_field_type',
        'invalid_field_value', 'invalid_format', 'invalid_range', 'invalid_enum', 'invalid_url', 'ungrounded_field',
        'invalid_price_range', 'empty_patch', 'confirm_patch_not_empty', 'required_field_missing', 'invalid_notes',
      ]);
      if (safeValidationErrors.has(code)) return reply.code(400).send({ error: code });
      request.log.error({ err: error }, 'unexpected curation staging failure');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  return app;
}
