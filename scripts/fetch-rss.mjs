import Parser from 'rss-parser';
import { config, AREA_LABELS } from './lib/config.mjs';
import {
  isActionableMarketAlert,
  normalizeGestoraId,
  slugify,
  toOpportunity,
} from './lib/monitor.mjs';
import { extractHousingData, extractGestoraContactFromText, pickOfficialWebsite, extractPromotionsFromText, discoverGestoraNames } from './lib/llm.mjs';
import { scrapeUrl, searchWeb, mapSite } from './lib/scraper.mjs';
import {
  getDatabase,
  saveOpportunity,
  getOpportunity,
  getAllOpportunities,
  saveSource,
  saveGestora,
  saveGestoraPromotion,
} from './lib/db.mjs';

const parser = new Parser({ customFields: { item: ['description'] } });
const feeds = config.feeds;

function stripAccents(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Registers a gestora by name if not already known, grounding its contact data in
 * a real scrape of its official site (never invented). Returns its stable id.
 * Reused by both the press pipeline and the discovery step.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} name - Gestora/promotora name
 * @returns {Promise<string>} The gestora id
 */
async function ensureGestora(db, name) {
  const gestoraId = normalizeGestoraId(name);
  const exists = db.prepare('SELECT count(*) as count FROM gestoras WHERE id = ?').all(gestoraId)[0].count > 0;
  if (exists) return gestoraId;

  console.log(`  [Autónomo] Nueva gestora: "${name}". Buscando su web real...`);
  let profile = null;

  const results = await searchWeb(`${name} vivienda cooperativa A Coruña web oficial contacto`);
  // La búsqueda puede devolver la web de otra empresa del sector; el LLM confirma cuál es la real.
  const matchedUrl = await pickOfficialWebsite(name, results);

  if (matchedUrl) {
    const pageMarkdown = await scrapeUrl(matchedUrl);
    if (pageMarkdown) {
      const grounded = await extractGestoraContactFromText(name, pageMarkdown);
      if (grounded) {
        profile = {
          website: grounded.website || matchedUrl,
          phone: grounded.phone,
          email: grounded.email,
          address: grounded.address,
          description: grounded.description || 'Promotora inmobiliaria detectada automáticamente por el monitor.',
        };
        console.log(`  [Autónomo] ✓ Contacto real extraído de ${matchedUrl}.`);
      }
    }
  }

  if (!profile) {
    console.log(`  [Autónomo] Sin web verificable para "${name}"; se registra sin inventar contacto.`);
  }

  saveGestora(db, {
    id: gestoraId,
    name,
    logo: name.slice(0, 2).toUpperCase(),
    website: profile?.website || '',
    phone: profile?.phone || '',
    email: profile?.email || '',
    address: profile?.address || '',
    description: profile?.description || 'Promotora inmobiliaria detectada automáticamente por el monitor.',
  });
  return gestoraId;
}

function parseIgvsListing(html, sourceUrl) {
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  const items = new Map();

  for (const [, href, rawTitle] of links) {
    if (!href.includes('/adjudicaciones-sorteos-de-vivienda-protegida/')) continue;
    const title = rawTitle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const date = title.match(/^(\d{2}\/\d{2}\/\d{4})/u)?.[1];
    if (!date) continue;
    const itemTitle = title.replace(/^\d{2}\/\d{2}\/\d{4}\s*/u, '');
    const link = new URL(href, sourceUrl).toString();
    items.set(link, { title: itemTitle, link, pubDate: date });
  }

  return [...items.values()];
}

async function parseFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { Accept: feed.format === 'html' ? 'text/html' : 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  if (feed.format === 'html') return parseIgvsListing(await response.text(), feed.url);

  const buffer = Buffer.from(await response.arrayBuffer());
  let xml = buffer.toString('utf8');
  if (xml.includes('\uFFFD') || xml.includes('Ã')) xml = buffer.toString('latin1');
  const parsed = await parser.parseString(xml);
  return parsed.items || [];
}

async function main() {
  const checkedAt = new Date().toISOString();
  const db = getDatabase();
  
  const results = await Promise.allSettled(feeds.map(parseFeed));
  const sources = [];
  const candidates = [];

  results.forEach((result, index) => {
    const feed = feeds[index];
    if (result.status === 'fulfilled') {
      const relevant = result.value
        .map((item) => toOpportunity(item, feed.name, checkedAt))
        .filter(Boolean)
        .map((item) => ({ ...item, sourceKind: feed.kind || 'official' }))
        .filter((item) => feed.kind !== 'market-alert' || isActionableMarketAlert(item, new Date(checkedAt)));
      candidates.push(...relevant);
      
      const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: true, scanned: result.value.length };
      sources.push(source);
      saveSource(db, source);
      console.log(`✓ ${feed.name}: ${result.value.length} revisados, ${relevant.length} relevantes`);
      return;
    }

    const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: false, scanned: 0 };
    sources.push(source);
    saveSource(db, source);
    console.error(`✗ ${feed.name}: ${result.reason?.message || 'error desconocido'}`);
  });

  if (!sources.some((source) => source.ok)) {
    throw new Error('No se pudo consultar ninguna fuente; se conservan los datos anteriores');
  }

  console.log('\n[IA/SQLite] Procesando novedades y enriqueciendo con LLM...');
  for (const item of candidates) {
    const old = getOpportunity(db, item.id);

    if (old && old.enriched) {
      // Ya procesado por el LLM (aunque no encontrara datos); no repetir la llamada.
      saveOpportunity(db, {
        ...item,
        precioMin: old.precioMin,
        precioMax: old.precioMax,
        habitacionesMin: old.habitacionesMin,
        banosMin: old.banosMin,
        promotora: old.promotora,
        totalViviendas: old.totalViviendas,
        garaje: old.garaje,
        trastero: old.trastero,
        terraza: old.terraza,
        nombrePromocion: old.nombrePromocion,
        enriched: true,
      });
    } else {
      let contentToAnalyze = item.summary || '';

      if (item.sourceKind === 'market-alert' && item.url) {
        console.log(`  [Scrape] Raspando artículo completo: "${item.title.slice(0, 45)}..."`);
        const fullMarkdown = await scrapeUrl(item.url);
        if (fullMarkdown) {
          contentToAnalyze = fullMarkdown.slice(0, 10000); // limit to ~2500 words to conserve tokens
          console.log(`  [Scrape] Éxito. Artículo obtenido (${contentToAnalyze.length} caracteres).`);
        } else {
          console.log(`  [Scrape] Inactivo o fallido. Usando snippet de prensa.`);
        }
      }

      const llmData = await extractHousingData(item.title, contentToAnalyze);

      const enrichedItem = {
        ...item,
        precioMin: llmData.precioMin,
        precioMax: llmData.precioMax,
        habitacionesMin: llmData.habitacionesMin,
        banosMin: llmData.banosMin,
        promotora: llmData.promotora,
        totalViviendas: llmData.totalViviendas,
        garaje: llmData.garaje,
        trastero: llmData.trastero,
        terraza: llmData.terraza,
        status: llmData.estado || item.status,
        nombrePromocion: llmData.nombrePromocion,
        // Si el LLM falló (cuota, red), no marcar enriched: reintentar en la próxima corrida.
        enriched: !llmData.llmCallFailed,
      };

      saveOpportunity(db, enrichedItem);

      if (enrichedItem.promotora) {
        const gestoraId = await ensureGestora(db, enrichedItem.promotora);
        const promoName = enrichedItem.nombrePromocion || enrichedItem.title.slice(0, 80);
        saveGestoraPromotion(db, {
          // Id por nombre para que dos noticias del mismo proyecto no dupliquen la promoción.
          id: `${gestoraId}:${slugify(promoName)}`,
          gestoraId,
          name: promoName,
          location: enrichedItem.location || 'A Coruña',
          status: enrichedItem.status || 'Sin confirmar',
          details: enrichedItem.summary,
          link: enrichedItem.url
        });
      }
      
      if (enrichedItem.precioMin || enrichedItem.promotora || enrichedItem.habitacionesMin) {
        console.log(`  [IA Extraído] ${enrichedItem.title.slice(0, 40)}... -> Promotora: ${enrichedItem.promotora || '?'}, Min €: ${enrichedItem.precioMin || '?'}`);
      }
    }
  }

  const items = getAllOpportunities(db, 150);
  console.log(`\n${items.length} oportunidades guardadas en SQLite.`);

  // Descubrimiento autónomo: sin lista fija, buscamos quién opera en la zona y registramos.
  // Varias queries y más resultados por query: una sola búsqueda superficial encontraba
  // apenas una gestora y se dejaba fuera cooperativas activas conocidas.
  console.log('\n[Descubrimiento] Buscando gestoras/promotoras en la zona...');
  const discoveryQueries = [
    'gestoras de cooperativas de viviendas en A Coruña',
    'promotoras de obra nueva en A Coruña',
    'cooperativas de viviendas en construcción A Coruña Oleiros Culleredo',
  ];
  const discoveredNames = new Set();
  for (const query of discoveryQueries) {
    const found = await discoverGestoraNames(await searchWeb(query, 10));
    found.forEach((n) => discoveredNames.add(n));
  }
  for (const name of discoveredNames) {
    await ensureGestora(db, name);
  }
  console.log(`  [Descubrimiento] ${discoveredNames.size} gestoras candidatas procesadas.`);

  // Catálogo real de cada gestora: mapeamos su sitio (los proyectos no suelen estar en la
  // portada) y el LLM lee solo lo scrapeado. Firecrawl trae, el LLM lee, nadie inventa.
  console.log('\n[Catálogo] Actualizando promociones y contacto desde la web de cada gestora...');
  const areaKeywords = AREA_LABELS.flatMap((label) => label.split(' · ')).map(stripAccents);
  const gestoras = db.prepare('SELECT id, name, logo, website, phone, email, address, description FROM gestoras').all();

  for (const gestora of gestoras) {
    if (!gestora.website) continue;

    const siteUrls = await mapSite(gestora.website);
    // Subpáginas relevantes: las que nombran un municipio del área o las que parecen
    // de promociones/proyectos (muchas gestoras no ponen el municipio en la URL).
    const relevantUrls = siteUrls.filter(
      (url) =>
        areaKeywords.some((kw) => stripAccents(url).includes(kw)) ||
        /promo|proyect|proxect|vivienda|obra|residencial/i.test(url),
    );
    const contactUrl = siteUrls.find((url) => /contacto|contact/i.test(url));
    // Si el mapeo no da nada relevante, caemos a la portada.
    const pagesToScrape = relevantUrls.length > 0 ? relevantUrls.slice(0, 12) : [gestora.website];

    const allPromotions = [];
    for (const pageUrl of pagesToScrape) {
      const pageMarkdown = await scrapeUrl(pageUrl);
      if (!pageMarkdown) continue;
      const promos = await extractPromotionsFromText(gestora.name, pageMarkdown);
      allPromotions.push(...promos);
    }

    if (allPromotions.length === 0) {
      console.log(`  [Catálogo] ${gestora.name}: no se encontraron promociones verificables en su web.`);
    } else {
      // Nombres ya presentes (p.ej. de prensa) para no duplicar la misma promoción.
      const seenNames = new Set(
        db.prepare('SELECT name FROM gestora_promotions WHERE gestoraId = ?')
          .all(gestora.id)
          .map((row) => slugify(row.name))
      );
      let added = 0;
      for (const promo of allPromotions) {
        const key = slugify(promo.nombre);
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        added++;
        saveGestoraPromotion(db, {
          // Id estable por nombre para no duplicar entre corridas ni pisar las de prensa.
          id: `site:${gestora.id}:${key}`,
          gestoraId: gestora.id,
          name: promo.nombre,
          location: promo.location || 'A Coruña',
          status: promo.estado || 'Sin confirmar',
          details: promo.totalViviendas ? `${promo.totalViviendas} viviendas` : '',
          link: gestora.website,
        });
      }
      console.log(`  [Catálogo] ${gestora.name}: ${added} promociones nuevas desde ${pagesToScrape.length} páginas de su web.`);
    }

    // Rellenar contacto si sigue vacío, desde la página de contacto real.
    if (!gestora.phone && !gestora.email && !gestora.address) {
      const contactMarkdown = await scrapeUrl(contactUrl || gestora.website);
      if (contactMarkdown) {
        const grounded = await extractGestoraContactFromText(gestora.name, contactMarkdown);
        if (grounded && (grounded.phone || grounded.email || grounded.address)) {
          saveGestora(db, {
            id: gestora.id,
            name: gestora.name,
            logo: gestora.logo || gestora.name.slice(0, 2).toUpperCase(),
            website: gestora.website,
            phone: grounded.phone,
            email: grounded.email,
            address: grounded.address,
            description: gestora.description || grounded.description || 'Promotora inmobiliaria detectada automáticamente por el monitor.',
          });
          console.log(`  [Catálogo] ${gestora.name}: contacto completado desde ${contactUrl || gestora.website}.`);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
