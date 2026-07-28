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

  return (opportunities) => {
    const counters = new Map();
    const markers = opportunities.flatMap((opportunity) => {
      const municipality = opportunity.municipalitySlug
        ? slugToName.get(opportunity.municipalitySlug)
        : null;
      const center = centroids.get(municipality);
      if (!center) return [];
      const index = counters.get(municipality) || 0;
      counters.set(municipality, index + 1);
      const angle = index * 2.39996;
      const radius = 0.008 * (index % 12);
      return [{
        lat: center[0] + radius * Math.cos(angle),
        lng: center[1] + radius * Math.sin(angle),
        title: `${opportunity.title}${opportunity.precioMin ? ` · Desde ${opportunity.precioMin.toLocaleString('es-ES')} €` : ''}`,
        url: `/oportunidad/${opportunity.id}`,
        color: opportunity.type === 'Cooperativa' ? '#1f4d36' : '#0369a1',
      }];
    });
    return { boundaries, markers };
  };
}