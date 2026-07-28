import { AREA_LABELS } from './config.mjs';

export const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
// ponytail: above char class is U+0300–U+036F combining diacritics, written literally

// AREA_LABELS agrupa sub-localidades con ' · ': el primer segmento es el municipio.
export const MUNICIPALITIES = AREA_LABELS.map((l) => l.split(' · ')[0]);

// Sub-localidad → municipio al que pertenece (para locations que vienen del pipeline).
const SUBLOCATION_TO_MUNI = Object.fromEntries(
  AREA_LABELS.flatMap((l) => {
    const [muni, ...subs] = l.split(' · ');
    return subs.map((sub) => [sub, muni]);
  })
);

const MUNI_SET = new Set(MUNICIPALITIES);

/** Municipio monitorizado al que pertenece una location, o null. */
export function resolveMunicipality(location) {
  if (!location) return null;
  if (MUNI_SET.has(location)) return location;
  return SUBLOCATION_TO_MUNI[location] ?? null;
}

const AREA_PATTERNS = [
  ['Abegondo', /\babegondo\b/i],
  ['Arteixo', /\b(?:arteixo|pastoriza)\b/i],
  ['Bergondo', /\bbergondo\b/i],
  ['Cambre', /\bcambre\b/i],
  ['Carral', /\bcarral\b/i],
  ['Culleredo', /\b(?:culleredo|o burgo|el burgo)\b/i],
  ['Oleiros', /\b(?:oleiros|perillo|mera|santa cruz|rabadeira|xaz)\b/i],
  ['Sada', /\bsada\b/i],
  ['A Coruña', /\b(?:a coruna|la coruna|xuxan|eiris|matogrande|parque ofimatico|oza|viono|someso|visma|mesoiro|cuatro caminos|juan florez|plaza de vigo|marques de amboage|almirante romay|alfredo vicenti|caballeros|ramon y cajal|finisterre)\b/i],
];

const OUT_OF_SCOPE_PATTERN = /\b(?:ferrol|canido|ares|vigo|pontevedra|castineirino|santiago|ermua|bezana|pedrena)\b/i;
const A_CORUNA_SPECIFIC_PATTERN = /\b(?:plaza de vigo|avenida de arteixo|avda de arteixo|san pedro de visma|someso|mesoiro|xuxan|eiris|matogrande|parque ofimatico|viono|cuatro caminos|juan florez|marques de amboage|almirante romay|alfredo vicenti|caballeros|ramon y cajal|finisterre)\b/i;

/** Clasifica ubicaciones libres sin asumir A Coruña cuando hay dudas. */
export function classifyPromotionLocation(location = '') {
  const normalized = slugify(location).replace(/-/g, ' ');
  if (!normalized) return { municipality: null, scopeStatus: 'unverified' };
  if (A_CORUNA_SPECIFIC_PATTERN.test(normalized)) return { municipality: 'A Coruña', scopeStatus: 'in_scope' };
  if (OUT_OF_SCOPE_PATTERN.test(normalized)) return { municipality: null, scopeStatus: 'out_of_scope' };
  const match = AREA_PATTERNS.find(([, pattern]) => pattern.test(normalized));
  if (match) return { municipality: match[0], scopeStatus: 'in_scope' };
  return { municipality: null, scopeStatus: 'unverified' };
}

/** Slug de /municipio/<slug> para una location, o null si está fuera del área. */
export function municipalitySlug(location) {
  const muni = resolveMunicipality(location);
  return muni ? slugify(muni) : null;
}

/** BASE_URL con trailing slash garantizado (Astro lo quita en build a veces). */
export const webBase = (baseUrl) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
