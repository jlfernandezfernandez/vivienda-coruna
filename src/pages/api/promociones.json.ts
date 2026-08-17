import type { APIRoute } from 'astro';
import { getDatabase, getAllOpportunities, getAllGestoras, getAllCooperatives, getAllSources } from '../../../scripts/lib/db.mjs';
import { clusterAndFuseOpportunities } from '../../../scripts/lib/dedup.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const db = getDatabase();
  const rawOpportunities = getAllOpportunities(db, 500);
  const fused = clusterAndFuseOpportunities(rawOpportunities);
  const gestoras = getAllGestoras(db);
  const cooperatives = getAllCooperatives(db);
  const sources = getAllSources(db);

  const payload = {
    status: 'success',
    generatedAt: new Date().toISOString(),
    metropolitanArea: 'A Coruña (A Coruña, Oleiros, Culleredo, Arteixo, Cambre, Sada, Bergondo, Carral, Abegondo)',
    metrics: {
      totalOpportunitiesFused: fused.length,
      totalPromotionsGestora: gestoras.flatMap(g => g.promotions).length,
      totalRegisteredCooperatives: cooperatives.length,
      activeSources: sources.filter(s => s.ok).length
    },
    data: {
      opportunities: fused,
      gestoras,
      cooperatives
    }
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
