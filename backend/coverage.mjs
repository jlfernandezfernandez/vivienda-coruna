import { slugify } from '../scripts/lib/municipios.mjs';

function centroid(feature) {
  const polygons = feature.geometry?.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry?.coordinates || [];
  let latitude = 0;
  let longitude = 0;
  let count = 0;
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0] || []) {
      longitude += lng;
      latitude += lat;
      count += 1;
    }
  }
  return count ? [latitude / count, longitude / count] : null;
}

export function createCoverageBuilder(geojson) {
  const boundaries = Array.isArray(geojson?.features) ? geojson.features : [];
  const centroids = new Map(
    boundaries.map((feature) => [feature.properties?.name, centroid(feature)]),
  );
  const slugToName = new Map(
    boundaries.map((feature) => [slugify(feature.properties?.name || ''), feature.properties?.name]),
  );

  return (opportunities = [], gestoras = []) => {
    const counters = new Map();
    const markers = [];

    for (const opportunity of (opportunities || [])) {
      const municipality = opportunity.municipalitySlug
        ? slugToName.get(opportunity.municipalitySlug)
        : (opportunity.municipality || null);
      const center = centroids.get(municipality);
      if (!center && (opportunity.lat == null || opportunity.lng == null)) continue;

      const index = counters.get(municipality) || 0;
      counters.set(municipality, index + 1);
      const angle = index * 2.39996;
      const radius = 0.008 * (index % 12);

      const lat = (opportunity.lat != null && opportunity.lng != null)
        ? opportunity.lat
        : (center ? center[0] + radius * Math.cos(angle) : null);
      const lng = (opportunity.lat != null && opportunity.lng != null)
        ? opportunity.lng
        : (center ? center[1] + radius * Math.sin(angle) : null);

      if (lat == null || lng == null) continue;

      markers.push({
        id: opportunity.id,
        title: opportunity.nombrePromocion || opportunity.title,
        category: opportunity.type || opportunity.tipoPromocion || 'Obra Nueva',
        type: opportunity.type || opportunity.tipoPromocion || 'Obra Nueva',
        status: opportunity.status,
        precioMin: opportunity.precioMin,
        habitacionesMin: opportunity.habitacionesMin,
        totalViviendas: opportunity.totalViviendas,
        promotora: opportunity.promotora,
        municipality: municipality || opportunity.municipality || opportunity.location,
        barrio: opportunity.barrio,
        lat,
        lng,
        url: `/oportunidad/${opportunity.id}`,
        color: opportunity.type === 'Cooperativa' ? '#1f4d36' : (opportunity.type === 'Vivienda protegida' ? '#be123c' : '#0369a1'),
        kind: 'opportunity',
      });
    }

    for (const gestora of (gestoras || [])) {
      for (const pr of (gestora.promotions || [])) {
        const municipality = pr.municipalitySlug
          ? slugToName.get(pr.municipalitySlug)
          : (pr.municipality || null);
        const center = centroids.get(municipality);
        if (!center && (pr.lat == null || pr.lng == null)) continue;

        const index = counters.get(municipality) || 0;
        counters.set(municipality, index + 1);
        const angle = index * 2.39996;
        const radius = 0.008 * (index % 12);

        const lat = (pr.lat != null && pr.lng != null)
          ? pr.lat
          : (center ? center[0] + radius * Math.cos(angle) : null);
        const lng = (pr.lat != null && pr.lng != null)
          ? pr.lng
          : (center ? center[1] + radius * Math.sin(angle) : null);

        if (lat == null || lng == null) continue;

        markers.push({
          id: pr.id,
          title: pr.name,
          category: pr.buscaSocios === 1 || pr.buscaSocios === true ? 'Cooperativa' : 'Obra Nueva',
          type: pr.buscaSocios === 1 || pr.buscaSocios === true ? 'Cooperativa' : 'Promoción nueva',
          status: pr.status,
          precioMin: pr.aportacionInicial ? pr.aportacionInicial * 4 : null,
          totalViviendas: null,
          promotora: gestora.name,
          municipality: municipality || pr.municipality || pr.location,
          barrio: pr.barrio,
          lat,
          lng,
          url: `/gestora/${pr.gestoraId || gestora.id}`,
          color: pr.buscaSocios === 1 || pr.buscaSocios === true ? '#1f4d36' : '#0369a1',
          kind: 'promotion',
        });
      }
    }

    return { boundaries, markers };
  };
}