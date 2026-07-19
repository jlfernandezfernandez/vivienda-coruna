import { createHash } from 'node:crypto';

export const AREA_LABELS = [
  'A Coruña',
  'Arteixo',
  'Culleredo · O Burgo',
  'Oleiros · Perillo · Santa Cruz',
  'Cambre',
  'Sada',
  'Bergondo',
  'Carral',
  'Abegondo',
];

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

const HOUSING_PATTERN = /\b(?:vpa|vpp|vivenda(?:s)?|vivienda(?:s)?|promoci[oó]n p[uú]blica|protexida(?:s)?|protegida(?:s)?|cooperativa(?:s)?|cohousing|autopromoci[oó]n|solo residencial|suelo residencial|reparcelaci[oó]n|parcela residencial)\b/i;
const NOISE_PATTERN = /\b(?:veh[ií]culo(?:s)?|h[ií]brido(?:s)?|vestiario|vestuario)\b/i;

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
  return Boolean(detectLocation(text)) && HOUSING_PATTERN.test(text) && !NOISE_PATTERN.test(text);
}

export function detectType(text = '') {
  if (/\b(?:cooperativa|cohousing|autopromoci[oó]n|vivienda colaborativa)/i.test(text)) return 'Cooperativa';
  if (/\b(?:solo|suelo|parcela|reparcelaci[oó]n)\b/i.test(text)) return 'Suelo';
  if (/\b(?:rehabilitaci[oó]n|rexurbe)\b/i.test(text)) return 'Rehabilitación';
  return 'Vivienda protegida';
}

export function detectStatus(text = '') {
  const match = cleanText(text).match(/Estado:\s*(En curso|Formalizado|Adxudicado|Adjudicado|Anulado|Deserto|Revogado|Resolto|Pendente|Publicada|Pr[oó]xima|Aberta)/i);
  return match?.[1]?.trim() || null;
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

  return {
    id: itemId(item),
    title,
    url: normalizeUrl(item.link || ''),
    source,
    publishedAt: Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString(),
    firstSeenAt: now,
    lastSeenAt: now,
    location: detectLocation(title),
    type: detectType(title),
    status: detectStatus(details),
    summary: details.slice(0, 260),
  };
}

export function isFreshMarketAlert(item, now = new Date()) {
  const published = new Date(item.publishedAt || item.firstSeenAt || 0);
  const age = now.getTime() - published.getTime();
  return !Number.isNaN(published.getTime()) && age >= 0 && age <= 180 * 24 * 60 * 60 * 1000;
}

function displayKey(item) {
  if (item.sourceKind === 'market-alert') return item.id;
  const caseId = item.title.match(/\bC\d{4}(?:CH)?\d+\b/i)?.[0];
  return caseId ? `case:${caseId.toUpperCase()}` : item.id;
}

export function mergeOpportunities(current, previous, now = new Date().toISOString()) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const merged = new Map();

  for (const item of current) {
    const old = previousById.get(item.id);
    merged.set(item.id, {
      ...item,
      firstSeenAt: old?.firstSeenAt || item.firstSeenAt || now,
      lastSeenAt: now,
    });
  }

  for (const old of previous) {
    if (!merged.has(old.id) && old.sourceKind !== 'market-alert' && isRelevantTitle(old.title)) merged.set(old.id, old);
  }

  const seenDisplayKeys = new Set();
  return [...merged.values()]
    .sort((a, b) => (b.publishedAt || b.firstSeenAt).localeCompare(a.publishedAt || a.firstSeenAt))
    .filter((item) => {
      const key = displayKey(item);
      if (seenDisplayKeys.has(key)) return false;
      seenDisplayKeys.add(key);
      return true;
    })
    .slice(0, 100);
}
