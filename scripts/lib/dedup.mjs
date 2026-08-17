/**
 * Intelligent Cross-Source Deduplication & Canonical Entity Fusion.
 * Pure JavaScript, 0 dependencies, 0 GPU / token cost.
 */

const STOPWORDS = new Set([
  'de', 'la', 'el', 'en', 'y', 'a', 'los', 'del', 'las', 'por', 'un', 'para', 'con', 'no', 'una',
  'su', 'al', 'lo', 'como', 'mas', 'pero', 'sus', 'le', 'ya', 'o', 'fue', 'este', 'ha', 'si',
  'porque', 'esta', 'son', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'ser', 'tiene',
  'tambien', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos',
  'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'e', 'esto', 'mi', 'antes',
  'algunos', 'que', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'polo', 'pola', 'polos',
  'noticia', 'anuncio', 'informe', 'area', 'metropolitana'
]);

const SYNONYMS = {
  pisos: 'viviendas',
  vivenda: 'viviendas',
  vivendas: 'viviendas',
  inmuebles: 'viviendas',
  vpo: 'vpp',
  vpa: 'vpp',
  protegida: 'vpp',
  protegidas: 'vpp',
  protegido: 'vpp',
  protegidos: 'vpp',
  ofimatico: 'xuxan',
};

export function tokenizeAndClean(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    .map(t => SYNONYMS[t] || t);
}

export function tokenJaccardSimilarity(textA = '', textB = '') {
  const tokensA = new Set(tokenizeAndClean(textA));
  const tokensB = new Set(tokenizeAndClean(textB));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0.0 : intersection / union;
}

export function levenshteinDistance(a = '', b = '') {
  const s1 = String(a).toLowerCase().trim();
  const s2 = String(b).toLowerCase().trim();

  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  let prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
  let curr = new Array(s2.length + 1);

  for (let i = 0; i < s1.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j] + 1,
        prev[j + 1] + 1,
        prev[j] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[s2.length];
}

export function normalizedStringSimilarity(a = '', b = '') {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

export function calculateMatchScore(itemA, itemB) {
  if (itemA.promotionId && itemB.promotionId && itemA.promotionId === itemB.promotionId) {
    return 1.0;
  }

  if (itemA.nombrePromocion && itemB.nombrePromocion) {
    const nameSim = normalizedStringSimilarity(itemA.nombrePromocion, itemB.nombrePromocion);
    if (nameSim >= 0.82) {
      return 0.98;
    }
  }

  const muniA = itemA.municipality || itemA.location;
  const muniB = itemB.municipality || itemB.location;
  if (muniA && muniB && muniA.toLowerCase() !== muniB.toLowerCase()) {
    return 0.0;
  }

  const dateA = new Date(itemA.publishedAt || itemA.firstSeenAt).getTime();
  const dateB = new Date(itemB.publishedAt || itemB.firstSeenAt).getTime();
  const daysDiff = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);

  const sameBarrio = itemA.barrio && itemB.barrio && itemA.barrio.toLowerCase() === itemB.barrio.toLowerCase();
  const sameTotalViv = itemA.totalViviendas && itemB.totalViviendas && itemA.totalViviendas === itemB.totalViviendas;
  const samePromotora = itemA.promotora && itemB.promotora &&
    normalizedStringSimilarity(itemA.promotora, itemB.promotora) >= 0.8;

  const titleJaccard = tokenJaccardSimilarity(itemA.title, itemB.title);

  if (sameBarrio && sameTotalViv && daysDiff <= 60 && titleJaccard >= 0.25) {
    return 0.95;
  }

  if (samePromotora && (sameBarrio || muniA) && titleJaccard >= 0.35) {
    return 0.92;
  }

  if (titleJaccard >= 0.60 && daysDiff <= 45) {
    return 0.88;
  }

  if (titleJaccard >= 0.75) {
    return 0.85;
  }

  return titleJaccard;
}

export function clusterAndFuseOpportunities(items = [], similarityThreshold = 0.80) {
  const n = items.length;
  if (n <= 1) return items;

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const score = calculateMatchScore(items[i], items[j]);
      if (score >= similarityThreshold) {
        union(i, j);
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(items[i]);
  }

  const fusedList = [];
  for (const group of clusters.values()) {
    fusedList.push(fuseOpportunityGroup(group));
  }

  return fusedList.sort((a, b) =>
    new Date(b.publishedAt || b.firstSeenAt).getTime() - new Date(a.publishedAt || a.firstSeenAt).getTime()
  );
}

export function fuseOpportunityGroup(group) {
  if (group.length === 1) {
    const item = group[0];
    return {
      ...item,
      sourcesCount: 1,
      citations: [{
        source: item.source,
        sourceKind: item.sourceKind,
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt || item.firstSeenAt
      }]
    };
  }

  const sorted = [...group].sort((a, b) => {
    if (a.sourceKind === 'official' && b.sourceKind !== 'official') return -1;
    if (b.sourceKind === 'official' && a.sourceKind !== 'official') return 1;
    if (a.nombrePromocion && !b.nombrePromocion) return -1;
    if (b.nombrePromocion && !a.nombrePromocion) return 1;
    return new Date(b.publishedAt || b.firstSeenAt).getTime() - new Date(a.publishedAt || a.firstSeenAt).getTime();
  });

  const primary = sorted[0];

  const citations = [];
  const seenUrls = new Set();
  for (const item of group) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      citations.push({
        source: item.source,
        sourceKind: item.sourceKind,
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt || item.firstSeenAt
      });
    }
  }

  const precioMin = group.map(i => i.precioMin).filter(Number.isFinite);
  const precioMax = group.map(i => i.precioMax).filter(Number.isFinite);
  const totalViviendas = group.map(i => i.totalViviendas).filter(Number.isFinite);

  return {
    ...primary,
    precioMin: precioMin.length ? Math.min(...precioMin) : primary.precioMin,
    precioMax: precioMax.length ? Math.max(...precioMax) : primary.precioMax,
    totalViviendas: totalViviendas.length ? Math.max(...totalViviendas) : primary.totalViviendas,
    habitacionesMin: group.find(i => i.habitacionesMin != null)?.habitacionesMin ?? primary.habitacionesMin,
    banosMin: group.find(i => i.banosMin != null)?.banosMin ?? primary.banosMin,
    promotora: group.find(i => i.promotora)?.promotora ?? primary.promotora,
    nombrePromocion: group.find(i => i.nombrePromocion)?.nombrePromocion ?? primary.nombrePromocion,
    garaje: group.some(i => i.garaje === true) ? true : primary.garaje,
    trastero: group.some(i => i.trastero === true) ? true : primary.trastero,
    terraza: group.some(i => i.terraza === true) ? true : primary.terraza,
    piscina: group.some(i => i.piscina === true) ? true : primary.piscina,
    ascensor: group.some(i => i.ascensor === true) ? true : primary.ascensor,
    lat: group.find(i => i.lat != null)?.lat ?? primary.lat,
    lng: group.find(i => i.lng != null)?.lng ?? primary.lng,
    barrio: group.find(i => i.barrio)?.barrio ?? primary.barrio,
    geoPrecision: group.find(i => i.geoPrecision === 'calle' || i.geoPrecision === 'barrio')?.geoPrecision ?? primary.geoPrecision,
    sourcesCount: citations.length,
    citations
  };
}
