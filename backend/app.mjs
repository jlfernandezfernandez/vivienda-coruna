import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';

function authorized(header, expectedToken) {
  if (!expectedToken || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function buildBackend({ repository, operationsApiKey, logger = false }) {
  const app = Fastify({ logger });

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

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/operations/')) return;
    if (!authorized(request.headers.authorization, operationsApiKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/v1/operations/diagnostics', async () => ({
    status: 'ok',
    ...repository.health(),
  }));

  return app;
}
