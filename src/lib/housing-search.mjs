export const searchText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const closedStatuses = new Set(['agotada/vendida', 'entregada']);

export function hasOpenRecruitment(item) {
  return item.buscaSocios === true && !closedStatuses.has(searchText(item.status));
}

export function directoryFilters(params) {
  const price = Number(params.get('maxPrice'));
  return {
    q: (params.get('q') || '').trim().slice(0, 120),
    municipality: (params.get('municipality') || '').trim().slice(0, 80),
    maxPrice: Number.isFinite(price) && price > 0 ? price : null,
    recruiting: params.get('recruiting') === '1',
    excludeClosed: params.get('excludeClosed') === '1',
  };
}

export function matchesHousing(item, filters, context = '') {
  const text = searchText([item.name, item.title, item.nombrePromocion, item.barrio,
    item.municipality, item.location, item.address, context].filter(Boolean).join(' '));
  if (!searchText(filters.q).split(/\s+/).every(word => text.includes(word))) return false;
  if (filters.municipality && searchText(item.municipality || item.location) !== searchText(filters.municipality)) return false;
  if (filters.recruiting && !hasOpenRecruitment(item)) return false;
  if (filters.excludeClosed && closedStatuses.has(searchText(item.status))) return false;
  // Unknown price is not a zero-euro home; retain it for enquiry and label it in the UI.
  return !filters.maxPrice || !(item.precioMin > 0) || item.precioMin <= filters.maxPrice;
}

export function searchGestoras(gestoras, filters) {
  return gestoras.flatMap(gestora => {
    const promotions = (gestora.promotions || []).filter(promo => matchesHousing(promo, filters, gestora.name));
    const unfilteredDirectory = !filters.municipality && !filters.recruiting && !filters.maxPrice && !filters.excludeClosed;
    if (promotions.length || (unfilteredDirectory && matchesHousing(gestora, filters))) return [{ ...gestora, promotions }];
    return [];
  });
}
