import type { APIRoute } from 'astro';
import { api } from '../../lib/api/client.mjs';
import { apiSafe } from '../../lib/api/boundary.mjs';

export const prerender = false;

export const GET: APIRoute = async () => {
  const dashboard = await apiSafe(null, () => api.dashboard(), {
    opportunities: [],
    sources: [],
    gestoras: [],
    cooperatives: [],
    events: [],
    municipalities: [],
    coverage: { boundaries: [], markers: [] },
  });

  const payload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'Vivienda Coruña Open Data Initiative',
      documentation: 'https://github.com/jlfernandezfernandez/vivienda-coruna',
      license: 'ODbL / Open Data Commons Open Database License',
      counts: {
        opportunities: (dashboard.opportunities || []).length,
        gestoras: (dashboard.gestoras || []).length,
        cooperatives: (dashboard.cooperatives || []).length,
        sources: (dashboard.sources || []).length
      }
    },
    opportunities: dashboard.opportunities || [],
    gestoras: dashboard.gestoras || [],
    cooperatives: dashboard.cooperatives || [],
    sources: dashboard.sources || []
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
