import { createHash } from 'node:crypto';

const PLACE_PATTERNS = [
  { label: 'Arteixo', pattern: /\barteixo\b/i },
  { label: 'O Burgo', pattern: /\b(?:o|el) burgo\b/i },
  { label: 'Culleredo', pattern: /\bculleredo\b/i },
  { label: 'Perillo', pattern: /\bperillo\b/i },
  { label: 'Santa Cruz', pattern: /\bsanta cruz\b/i },
  { label: 'Oleiros', pattern: /\boleiros\b/i },
  { label: 'Cambre', pattern: /\bcambre\b/i },
  { label: 'Sada', pattern: /\bsada\b/i },
  { label: 'Carral', pattern: /\bcarral\b/i },
  { label: 'Abegondo', pattern: /\babegondo\b/i },
  { label: 'Bergondo', pattern: /\bbergondo\b/i },
  {
    label: 'A Coruña',
    pattern: /(?:^|\b)(?:concello|municipio|ayuntamiento|termo municipal) (?:de |da )?a coruña\b|\b(?:en|na) a coruña\b|\ba coruña cidade\b|\b(?:área|area) (?:metropolitana )?de a coruña\b|\ba coruña\s*[-—:]/i,
  },
];
const HOUSING_PATTERN = /\b(?:vpa|vpp|vivenda(?:s)?|vivienda(?:s)?|obra nueva|promoci[oó]n nueva|promoci[oó]n inmobiliaria|promoci[oó]n residencial|promoci[oó]n p[uú]blica|protexida(?:s)?|protegida(?:s)?|cooperativa(?:s)?|cohousing|covivienda|autopromoci[oó]n|solo residencial|suelo residencial|reparcelaci[oó]n|parcela residencial|edificio residencial|proyecto residencial|promotora|constructora|gestora|libra gp|libra gesti[oó]n|galivivienda|gescomar|prygesa|gestogar|metrovacesa|avantespacia|aelca|neinor|c[eé]lere)\b/i;
const NOISE_PATTERN = /\b(?:veh[ií]culo(?:s)?|h[ií]brido(?:s)?|vestiario|vestuario|fotocasa|idealista)\b/i;
const GARBAGE_PATTERN = /\b(?:yaencontre|nestoria|habitaclia|fotocasa|idealista|reformantia|subastasdelboe|tramitesayuntamiento|solicitud de licencias de obra para reforma|promociones de obra nueva en|inmuebles de obra nueva en|obra nueva en.*promociones en venta|obra nueva con entrega para)\b/i;
const MARKET_CONTEXT_NOISE_PATTERN = /\b(?:costes?|demanda|mercado|informe|an[aá]lisis|sin construir)\b/i;

export function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeUrl(value = '') {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    return url.toString();
  } catch {
    return value;
  }
}

export function detectLocation(title = '') {
  const text = cleanText(title);
  return PLACE_PATTERNS.find(({ pattern }) => pattern.test(text))?.label ?? null;
}

export function isRelevantTitle(title = '') {
  const text = cleanText(title);
  return Boolean(detectLocation(text)) && HOUSING_PATTERN.test(text) && !NOISE_PATTERN.test(text) && !GARBAGE_PATTERN.test(text);
}

export function detectType(text = '', sourceKind = '') {
  const clean = cleanText(text).toLowerCase();
  if (/\b(?:cooperativa|cohousing|autopromoci[oó]n|vivienda colaborativa)/i.test(clean)) return 'Cooperativa';
  if (/\b(?:suelo|parcela|reparcelaci[oó]n|terreno|tuparcela|solares)\b/i.test(clean)) return 'Suelo';
  if (/\b(?:rehabilitaci[oó]n|rexurbe)\b/i.test(clean)) return 'Rehabilitación';
  if (/\b(?:obra nueva|promoci[oó]n|licencia|construir|construye|construya|edificio|residencial|viviendas|pisos|chalets|inmobiliaria)\b/i.test(clean) || sourceKind === 'market-alert') {
    // Si contiene explícitamente "protegida", "social", "pública" o "vpp/vpa" en prensa, sigue siendo protegida
    if (/\b(?:vpp|vpa|protegida|social|p[uú]blica)\b/i.test(clean)) {
      return 'Vivienda protegida';
    }
    return 'Promoción nueva';
  }
  return 'Vivienda protegida';
}

export function detectStatus(text = '') {
  const match = cleanText(text).match(/Estado:\s*(En curso|Formalizado|Adxudicado|Adjudicado|Anulado|Deserto|Revogado|Resolto|Pendente|Publicada|Pr[oó]xima|Aberta)/i);
  return match?.[1]?.trim() || null;
}

const GESTORA_NAME_NOISE = /\b(?:grupo|promociones|inmobiliaria|constructora|s\.?l\.?u?|s\.?a\.?u?)\b\.?/gi;

/**
 * Normalizes a developer/gestora name so the same real company always maps to
 * the same id, regardless of how the LLM phrased it across runs (e.g.
 * "grupo Nozar" vs "Nozar" vs "Nozar S.A.").
 *
 * @param {string} name - Raw promotora name as returned by the LLM
 * @returns {string} Normalized slug-safe id
 */
export function normalizeGestoraId(name = '') {
  return name
    .toLowerCase()
    .replace(GESTORA_NAME_NOISE, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Plain slug for arbitrary text (e.g. a promotion name), used to build stable ids.
 *
 * @param {string} text - Text to slugify
 * @returns {string} Slug-safe id fragment
 */
export function slugify(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function itemId(item) {
  const identity = normalizeUrl(item.link || item.guid || '') || cleanText(item.title || '');
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

function parsePublicationDate(value = '') {
  const spanish = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (spanish) return new Date(Date.UTC(Number(spanish[3]), Number(spanish[2]) - 1, Number(spanish[1])));
  return new Date(value);
}

export function toOpportunity(item, source, now = new Date().toISOString()) {
  const title = cleanText(item.title);
  if (!isRelevantTitle(title)) return null;

  const details = cleanText(item.contentSnippet || item.content || item.description || '');
  const parsedDate = parsePublicationDate(item.isoDate || item.pubDate || '');
  const sourceKind = source && source.startsWith('Prensa') ? 'market-alert' : 'official';

  return {
    id: itemId(item),
    title,
    url: normalizeUrl(item.link || ''),
    source,
    publishedAt: Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString(),
    firstSeenAt: now,
    lastSeenAt: now,
    location: detectLocation(title),
    type: detectType(title, sourceKind),
    status: detectStatus(details),
    summary: details.slice(0, 260),
  };
}

export function isFreshMarketAlert(item, now = new Date()) {
  const published = new Date(item.publishedAt || item.firstSeenAt || 0);
  const age = now.getTime() - published.getTime();
  return !Number.isNaN(published.getTime()) && age >= 0 && age <= 180 * 24 * 60 * 60 * 1000;
}

export function isActionableMarketAlert(item, now = new Date()) {
  return isFreshMarketAlert(item, now) && !MARKET_CONTEXT_NOISE_PATTERN.test(cleanText(item.title));
}
