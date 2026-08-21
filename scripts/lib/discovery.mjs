import { slugify } from './monitor.mjs';

export const DISCOVERY_RESULT_LIMIT = 20;

// Consultas complementarias: combinan tipo de entidad, idioma y municipios para
// no depender de una única SERP dominada por portales inmobiliarios nacionales.
export const GESTORA_DISCOVERY_QUERIES = [
  'gestoras de cooperativas de viviendas en A Coruña área metropolitana',
  'promotoras de obra nueva en A Coruña web oficial',
  'gestora cooperativas vivienda Galicia A Coruña',
  'cooperativa galega de vivendas A Coruña Oleiros',
  'promotora inmobiliaria A Coruña Oleiros Sada promociones',
  'obra nueva promotora Arteixo Culleredo Cambre',
  'cooperativas de viviendas protegidas A Coruña gestora promotora',
  'promoción residencial Bergondo Carral Abegondo promotora',
  'autopromoción colectiva cohousing A Coruña gestora',
  'gestión de cooperativas de vivienda Galicia A Coruña',
];

const PROJECT_KEYWORDS = /promo|proyect|proxect|vivienda|vivenda|obra-nueva|residencial|edificio|torre|urbanizacion|cooperativa|cohousing|catalogo|inmueble/i;
const AREA_KEYWORDS = /a-coruna|la-coruna|coruna|arteixo|culleredo|o-burgo|oleiros|perillo|santa-cruz|cambre|sada|bergondo|carral|abegondo|xuxan|someso|visma|matogrande|eiris|oza/i;
const EXCLUDED_KEYWORDS = /contacto|contact|aviso-legal|politica|privacidad|cookies|blog|noticias|news|equipo|quienes-somos|sobre-nosotros/i;

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Select same-origin project/catalog pages while retaining the homepage as a
 * fallback. Area-specific project URLs rank above generic catalog pages.
 */
export function selectCatalogUrls(siteUrls, website, limit = 35) {
  const homepage = canonicalUrl(website);
  if (!homepage || limit <= 0) return [];
  const origin = new URL(homepage).origin;
  const candidates = new Map();

  for (const rawUrl of [...siteUrls, homepage]) {
    const url = canonicalUrl(rawUrl);
    if (!url || new URL(url).origin !== origin || EXCLUDED_KEYWORDS.test(url)) continue;
    let score = url === homepage ? 1 : 0;
    if (PROJECT_KEYWORDS.test(url)) score += 20;
    if (AREA_KEYWORDS.test(url)) score += 12;
    if (score <= 0) continue;
    candidates.set(url, Math.max(score, candidates.get(url) || 0));
  }

  const selected = [...candidates]
    .sort(([urlA, scoreA], [urlB, scoreB]) => scoreB - scoreA || urlA.localeCompare(urlB))
    .map(([url]) => url)
    .slice(0, limit);

  if (!selected.includes(homepage)) {
    if (selected.length >= limit) selected[selected.length - 1] = homepage;
    else selected.push(homepage);
  }
  return selected;
}

/**
 * Crawl a manager/developer site and persist grounded metropolitan promotions.
 * Dependencies are injected so the traversal and deduplication stay testable.
 */
export async function crawlGestoraCatalog(gestora, dependencies, options = {}) {
  const {
    mapSite,
    scrapeUrl,
    extractPromotionsFromText,
    savePromotion,
  } = dependencies;
  const maxPages = options.maxPages ?? 35;
  const siteUrls = await mapSite(gestora.website);
  const pages = selectCatalogUrls(siteUrls, gestora.website, maxPages);
  const seen = new Set();
  let promotionsFound = 0;

  for (const pageUrl of pages) {
    const markdown = await scrapeUrl(pageUrl);
    if (!markdown) continue;
    const promotions = await extractPromotionsFromText(gestora.name, markdown, pageUrl);
    for (const promotion of promotions) {
      const key = slugify(promotion.nombre);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      promotionsFound += 1;
      savePromotion({
        id: `promo:${gestora.id}:${key}`,
        gestoraId: gestora.id,
        name: promotion.nombre,
        location: promotion.location || '',
        status: promotion.estado || 'Sin confirmar',
        details: promotion.totalViviendas ? `${promotion.totalViviendas} viviendas` : '',
        link: pageUrl,
        entregaEstimada: promotion.entregaEstimada,
        buscaSocios: promotion.buscaSocios,
        aportacionInicial: promotion.aportacionInicial,
        precioMin: promotion.precioMin,
        precioMax: promotion.precioMax,
      });
    }
  }

  return { pagesScanned: pages.length, promotionsFound };
}
