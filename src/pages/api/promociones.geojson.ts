import type { APIRoute } from 'astro';
import { getDatabase, getAllOpportunities, getAllGestoras, getAllCooperatives } from '../../../scripts/lib/db.mjs';
import { clusterAndFuseOpportunities } from '../../../scripts/lib/dedup.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const db = getDatabase();
  const rawOpportunities = getAllOpportunities(db, 500);
  const fusedOpportunities = clusterAndFuseOpportunities(rawOpportunities);
  const gestoras = getAllGestoras(db);
  const cooperatives = getAllCooperatives(db);

  const features: any[] = [];

  for (const op of fusedOpportunities) {
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
        sourcesCount: op.sourcesCount || 1,
        citations: op.citations || [{ source: op.source, url: op.url }]
      }
    });
  }

  for (const g of gestoras) {
    for (const p of g.promotions) {
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
          nombrePromocion: p.name,
          tipoPromocion: p.buscaSocios ? 'Cooperativa' : 'Obra Nueva',
          status: p.buscaSocios ? 'Captación abierta' : (p.status || 'Comercialización'),
          municipality: p.municipality || p.location,
          barrio: p.barrio || null,
          geoPrecision: p.geoPrecision || 'barrio',
          promotora: g.name,
          gestoraId: g.id,
          buscaSocios: p.buscaSocios === true,
          aportacionInicial: p.aportacionInicial || null,
          entregaEstimada: p.entregaEstimada || null,
          link: p.link || g.website,
          sourcesCount: 1,
          citations: [{ source: `Web Oficial ${g.name}`, url: p.link || g.website }]
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
        id: `coop:${c.cif}`,
        entityType: 'registry_cooperative',
        title: c.name,
        nombrePromocion: c.name,
        tipoPromocion: 'Cooperativa',
        status: 'Registrada',
        municipality: c.municipality,
        barrio: c.barrio || null,
        geoPrecision: c.geoPrecision || 'municipio',
        cif: c.cif,
        numRegistro: c.numRegistro,
        foundedAt: c.foundedAt,
        foundingPartners: c.foundingPartners,
        address: c.address,
        postalCode: c.postalCode,
        sourcesCount: 1,
        citations: [{ source: 'Rexistro Oficial de Cooperativas da Xunta de Galicia', url: 'https://abertos.xunta.gal/' }]
      }
    });
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      title: 'Vivienda Coruña - Datos Abiertos de Vivienda Metropolitano',
      description: 'Promociones residenciales, cooperativas y suelo en A Coruña y su área metropolitana.',
      generatedAt: new Date().toISOString(),
      bbox: [-8.55, 43.20, -8.20, 43.40],
      totalFeatures: features.length
    },
    features
  };

  return new Response(JSON.stringify(geojson, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
