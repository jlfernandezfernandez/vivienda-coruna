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

/** Slug de /municipio/<slug> para una location, o null si está fuera del área. */
export function municipalitySlug(location) {
  const muni = resolveMunicipality(location);
  return muni ? slugify(muni) : null;
}

/** BASE_URL con trailing slash garantizado (Astro lo quita en build a veces). */
export const webBase = (baseUrl) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
