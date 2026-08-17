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

  const rawOpportunities = dashboard.opportunities || [];
  const gestoras = dashboard.gestoras || [];
  const cooperatives = dashboard.cooperatives || [];

  const features: any[] = [];

  for (const op of rawOpportunities) {
    if (op.lat == null || op.lng == null) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [op.lng, op.lat]
      },
      properties: {
        id: op.id,
        entityType: 'opportunity',
        title: op.title,
        nombrePromocion: op.nombrePromocion || null,
        tipoPromocion: op.tipoPromocion || op.type || null,
        status: op.status || 'En seguimiento',
        municipality: op.municipality || op.location,
        barrio: op.barrio || null,
        geoPrecision: op.geoPrecision || 'barrio',
        precioMin: op.precioMin || null,
        precioMax: op.precioMax || null,
        habitacionesMin: op.habitacionesMin || null,
        banosMin: op.banosMin || null,
        totalViviendas: op.totalViviendas || null,
        promotora: op.promotora || null,
        entregaEstimada: op.entregaEstimada || null,
        garaje: op.garaje === true,
        trastero: op.trastero === true,
        terraza: op.terraza === true,
        piscina: op.piscina === true,
        ascensor: op.ascensor === true,
        publishedAt: op.publishedAt || op.firstSeenAt,
        source: op.source,
        url: op.url
      }
    });
  }

  for (const g of gestoras) {
    for (const p of (g.promotions || [])) {
      if (p.lat == null || p.lng == null) continue;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [p.lng, p.lat]
        },
        properties: {
          id: p.id,
          entityType: 'gestora_promotion',
          title: p.name,
          gestoraId: g.id,
          gestoraName: g.name,
          location: p.location,
          municipality: p.municipality || g.address || null,
          barrio: p.barrio || null,
          geoPrecision: p.geoPrecision || 'parcela',
          status: p.status || 'En captación',
          buscaSocios: p.buscaSocios === true,
          aportacionInicial: p.aportacionInicial || null,
          entregaEstimada: p.entregaEstimada || null,
          details: p.details || null,
          link: p.link || g.website || null
        }
      });
    }
  }

  for (const c of cooperatives) {
    if (c.lat == null || c.lng == null) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [c.lng, c.lat]
      },
      properties: {
        id: c.cif,
        entityType: 'cooperative',
        title: c.name,
        numRegistro: c.numRegistro || null,
        municipality: c.municipality || 'A Coruña',
        barrio: c.barrio || null,
        geoPrecision: c.geoPrecision || 'municipio',
        address: c.address || null,
        foundedAt: c.foundedAt || null,
        foundingPartners: c.foundingPartners || null,
        email: c.email || null,
        phone: c.phone || null
      }
    });
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'Vivienda Coruña Open Data Initiative',
      license: 'Open Data Commons Public Domain Dedication and License (PDDL)',
      count: features.length
    },
    features
  };

  return new Response(JSON.stringify(geojson, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
