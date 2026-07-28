const RETRYABLE_STATUS = new Set([502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 5_000;

export class ApiError extends Error {
  constructor(message, { status = null, kind = 'unavailable', cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

function requiredArray(value, name) {
  if (!Array.isArray(value)) throw new ApiError(`Invalid ${name} API contract`, { kind: 'invalid_contract' });
  return value;
}

function dashboardContract(value) {
  if (!value || typeof value !== 'object') throw new ApiError('Invalid dashboard API contract', { kind: 'invalid_contract' });
  for (const name of ['opportunities', 'sources', 'gestoras', 'cooperatives', 'events', 'municipalities']) requiredArray(value[name], name);
  if (!value.coverage || !Array.isArray(value.coverage.boundaries) || !Array.isArray(value.coverage.markers)) {
    throw new ApiError('Invalid dashboard coverage API contract', { kind: 'invalid_contract' });
  }
  return value;
}

function arrayContract(value, name) {
  return requiredArray(value, name);
}

function objectContract(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(`Invalid ${name} API contract`, { kind: 'invalid_contract' });
  }
  return value;
}

function seoContract(value) {
  objectContract(value, 'seo routes');
  for (const name of ['municipalities', 'opportunities', 'gestoras']) {
    requiredArray(value[name], `seo routes.${name}`);
  }
  return value;
}

function resolveUrl(baseUrl, path) {
  return new URL(path.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`).toString();
}

export function createApiClient({
  baseUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('An implementation of fetch is required');

  async function get(path, contract) {
    const url = resolveUrl(baseUrl, `/api/v1/${path}`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
        if (RETRYABLE_STATUS.has(response.status) && attempt === 0) continue;
        if (!response.ok) {
          const kind = response.status === 404 ? 'not_found' : 'unavailable';
          throw new ApiError(`API request failed with ${response.status}`, { status: response.status, kind });
        }
        let payload;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new ApiError('API returned invalid JSON', { kind: 'invalid_contract', cause });
        }
        return contract(payload);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (attempt === 0) continue;
        throw new ApiError('API is unavailable', { kind: 'unavailable', cause: error });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ApiError('API is unavailable', { kind: 'unavailable' });
  }

  return {
    dashboard: () => get('dashboard', dashboardContract),
    opportunity: (id) => get(`opportunities/${encodeURIComponent(id)}`, (value) => objectContract(value, 'opportunity')),
    gestoras: () => get('gestoras', (value) => arrayContract(value, 'gestoras')),
    gestora: (id) => get(`gestoras/${encodeURIComponent(id)}`, (value) => objectContract(value, 'gestora')),
    cooperatives: () => get('cooperatives', (value) => arrayContract(value, 'cooperatives')),
    municipality: (slug) => get(`municipalities/${encodeURIComponent(slug)}`, (value) => objectContract(value, 'municipality')),
    seoRoutes: () => get('seo/routes', seoContract),
  };
}

export const api = createApiClient();
