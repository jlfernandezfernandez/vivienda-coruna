import Parser from 'rss-parser';
import { config, AREA_LABELS } from './lib/config.mjs';
import {
  isActionableMarketAlert,
  normalizeGestoraId,
  parseCooperativeRegistryCsv,
  slugify,
  toOpportunity,
} from './lib/monitor.mjs';
import { extractHousingData, extractGestoraContactFromText, pickOfficialWebsite, extractPromotionsFromText, discoverGestoraNames, validateExtractedHousingData } from './lib/llm.mjs';
import { extractWithRegex } from './lib/regex-extractor.mjs';
import { EXTRACTOR_VERSION, shouldReprocessOpportunity, shouldUseComplementaryExtraction } from './lib/extraction-policy.mjs';
import { requirePipelineWriter } from './lib/writer-lock.mjs';
import { scrapeUrl, searchWeb, mapSite, fetchText } from './lib/scraper.mjs';
import {
  getDatabase,
  saveOpportunity,
  getOpportunity,
  getAllOpportunities,
  saveSource,
  saveGestora,
  saveGestoraPromotion,
  saveCooperative,
  finalizeRegistryImport,
} from './lib/db.mjs';

// Rexistro de Cooperativas da Xunta (datos abertos, CC BY-SA, actualización ~bimestral).
const COOP_REGISTRY_CSV_URL =
  'https://abertos.xunta.gal/catalogo/economia-empresa-emprego/-/dataset/0606/rexistro-cooperativas-galicia/001/descarga-directa-ficheiro.csv';

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
  if (xml.includes('\uFFFD')) xml = buffer.toString('latin1');
  const parsed = await parser.parseString(xml);
  return parsed.items || [];
}

async function main() {
  requirePipelineWriter();
  const checkedAt = new Date().toISOString();
  const db = getDatabase();
  
  const results = await Promise.allSettled(feeds.map(parseFeed));
  const sources = [];
  const candidates = [];

  results.forEach((result, index) => {
    const feed = feeds[index];
    if (result.status === 'fulfilled') {
      const items = result.value;
      // Fuente muerta en silencio: 0 ítems, o un RSS oficial cuyo ítem más reciente
      // tiene >45 días (el feed de taxonomía del DOG llevaba 3 años congelado dando
      // ok:true). Prensa no: una query de nicho sin novedades recientes es normal.
      const newest = Math.max(0, ...items.map((i) => Date.parse(i.isoDate || i.pubDate || '')).filter(Number.isFinite));
      // Prensa (market-alert) con 0 ítems no es fallo: una query de nicho sin
      // novedades es normal y no debe contar para el abort global.
      const dead =
        (items.length === 0 && feed.kind !== 'market-alert') ||
        (feed.kind !== 'market-alert' && newest > 0 && Date.now() - newest > 45 * 24 * 60 * 60 * 1000);
      if (dead) {
        const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: false, scanned: 0 };
        sources.push(source);
        saveSource(db, source);
        console.error(`✗ ${feed.name}: ${items.length === 0 ? '0 ítems (¿fuente rota?)' : 'feed congelado (>45 días sin ítems nuevos)'}`);
        return;
      }

      const relevant = items
        .map((item) => toOpportunity(item, feed.name, checkedAt))
        .filter(Boolean)
        .map((item) => ({ ...item, sourceKind: feed.kind || 'official' }))
        .filter((item) => feed.kind !== 'market-alert' || isActionableMarketAlert(item, new Date(checkedAt)));
      candidates.push(...relevant);

      const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: true, scanned: items.length };
      sources.push(source);
      saveSource(db, source);
      console.log(`✓ ${feed.name}: ${items.length} revisados, ${relevant.length} relevantes`);
      return;
    }

    const source = { name: feed.name, url: feed.url, kind: feed.kind || 'official', ok: false, scanned: 0 };
    sources.push(source);
    saveSource(db, source);
    console.error(`✗ ${feed.name}: ${result.reason?.message || 'error desconocido'}`);
  });

  // Elimina del estado fuentes que ya no forman parte de la configuración activa;
  // mantenerlas como "ok" sin volver a consultarlas falsearía la salud del monitor.
  const activeSourceNames = new Set(feeds.map((feed) => feed.name));
  const managedSourceKinds = new Set(feeds.map((feed) => feed.kind || 'official'));
  const deleteSource = db.prepare('DELETE FROM sources WHERE name = ?');
  for (const row of db.prepare('SELECT name, kind FROM sources').all()) {
    if (managedSourceKinds.has(row.kind) && !activeSourceNames.has(row.name)) deleteSource.run(row.name);
  }

  if (!sources.some((source) => source.ok)) {
    throw new Error('No se pudo consultar ninguna fuente; se conservan los datos anteriores');
  }

  console.log('\n[IA/SQLite] Procesando novedades y enriqueciendo con LLM...');
  for (const item of candidates) {
    const old = getOpportunity(db, item.id);

    if (old && old.enriched && !shouldReprocessOpportunity(old)) {
      // Conserva las extracciones completas. Las filas enriquecidas sin precio se
      // revisitan una sola vez por versión del extractor para aprovechar mejoras.
      saveOpportunity(db, {
        ...item,
        status: old.status || item.status,
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
        promotionId: old.promotionId,
        evidenceText: old.evidenceText,
        extractionMethod: old.extractionMethod,
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
      } else if (item.url) {
        // Fuentes oficiales (DOG, contratos): HTML estático, sin cuota Firecrawl.
        const text = await fetchText(item.url);
        if (text) contentToAnalyze = text.slice(0, 10000);
      }

      // ── Fase 1: Regex (gratis, captura ~80% de los casos) ──
      const regexData = extractWithRegex(item.title + '\n' + contentToAnalyze);
      const regexFields = regexData._regexFieldsFound || 0;

      const useComplementaryExtraction = shouldUseComplementaryExtraction(regexData, item.sourceKind);

      let llmData;
      if (useComplementaryExtraction) {
        // Regex no pudo sacar suficiente → LLM
        const llmResult = await extractHousingData(item.title, contentToAnalyze);
        const regexValues = Object.fromEntries(Object.entries(regexData).filter(([key, value]) => !key.startsWith('_') && value !== null && value !== undefined));
        // Regex es evidencia determinista y prevalece; el LLM solo completa huecos.
        llmData = validateExtractedHousingData({ ...llmResult, ...regexValues, llmCallFailed: llmResult.llmCallFailed }, item.title, contentToAnalyze);
        console.log(`  [Regex→LLM] ${regexFields} campos por regex, ${Object.values(llmData).filter(v => v !== null && v !== undefined).length - 1} por LLM`);
      } else {
        // Regex cubrió todo → sin gasto de LLM
        llmData = validateExtractedHousingData({ ...regexData, llmCallFailed: false }, item.title, contentToAnalyze);
        console.log(`  [Regex] ${regexFields} campos extraídos sin LLM (ahorro ~500 tokens)`);
      }
      if (item.sourceKind === 'market-alert') {
        llmData.totalViviendas = validateExtractedHousingData(
          { totalViviendas: llmData.totalViviendas }, item.title, '',
        ).totalViviendas;
      }

      // Id de promoción compartido con el catálogo de la gestora: prensa y web
      // colisionan en la misma fila en vez de duplicar la promoción.
      let gestoraId = null;
      let promotionId = null;
      const promoName = llmData.nombrePromocion || item.title.slice(0, 80);
      if (llmData.promotora) {
        gestoraId = await ensureGestora(db, llmData.promotora);
        promotionId = `promo:${gestoraId}:${slugify(promoName)}`;
      }

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
        piscina: llmData.piscina,
        ascensor: llmData.ascensor,
        entregaEstimada: llmData.entregaEstimada,
        tipoPromocion: llmData.tipoPromocion || item.type,
        municipio: llmData.municipio,
        barrio: llmData.barrio,
        direccion: llmData.direccion,
        status: llmData.estado || item.status,
        nombrePromocion: llmData.nombrePromocion,
        promotionId,
        evidenceText: contentToAnalyze.slice(0, 10000),
        extractionMethod: useComplementaryExtraction
          ? (llmData.llmCallSkipped ? 'regex-no-llm' : 'regex+llm')
          : 'regex',
        extractorVersion: EXTRACTOR_VERSION,
        // Si el LLM falló (cuota, red), no marcar enriched: reintentar en la próxima corrida.
        enriched: llmData.llmCallSkipped || !llmData.llmCallFailed,
      };

      saveOpportunity(db, enrichedItem);

      if (gestoraId) {
        saveGestoraPromotion(db, {
          id: promotionId,
          gestoraId,
          name: promoName,
          location: enrichedItem.location || '',
          status: enrichedItem.status || 'Sin confirmar',
          details: enrichedItem.summary,
          link: enrichedItem.url,
          precioMin: enrichedItem.precioMin,
          precioMax: enrichedItem.precioMax,
        });
      }
      
      if (enrichedItem.precioMin || enrichedItem.promotora || enrichedItem.habitacionesMin) {
        console.log(`  [IA Extraído] ${enrichedItem.title.slice(0, 40)}... -> Promotora: ${enrichedItem.promotora || '?'}, Min €: ${enrichedItem.precioMin || '?'}`);
      }
    }
  }

  const items = getAllOpportunities(db, 150);
  console.log(`\n${items.length} oportunidades guardadas en SQLite.`);

  // Rexistro de Cooperativas da Xunta: la verdad oficial de qué cooperativas existen.
  // Diff por CIF entre corridas → detecta constituciones semanas antes que la prensa.
  console.log('\n[Rexistro] Importando cooperativas de vivienda del rexistro oficial...');
  try {
    const response = await fetch(COOP_REGISTRY_CSV_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // La Xunta a veces exporta en ISO-8859-1: decodificar UTF-8 y, si aparecen
    // caracteres de reemplazo (U+FFFD), reintentar como latin1.
    const buffer = Buffer.from(await response.arrayBuffer());
    let csvText = buffer.toString('utf8');
    if (csvText.includes('�')) csvText = buffer.toString('latin1');
    const registryRows = parseCooperativeRegistryCsv(csvText);
    if (registryRows.length < 5) throw new Error(`CSV anómalo: solo ${registryRows.length} cooperativas válidas`);
    const seenAt = new Date().toISOString();
    for (const row of registryRows) {
      saveCooperative(db, { ...row, firstSeenAt: seenAt, lastSeenAt: seenAt });
    }
    finalizeRegistryImport(db, seenAt);
    console.log(`  [Rexistro] ${registryRows.length} cooperativas de vivienda activas en el área.`);
  } catch (error) {
    console.error(`  [Rexistro] Fallo al importar el CSV (se conservan los datos anteriores): ${error.message}`);
  }

  // En modo rápido terminamos tras feeds + novedades + registro oficial. Evita
  // remapear y releer catálogos nacionales varias veces al día.
  if (process.env.FAST_REFRESH === '1') {
    console.log('\n[Modo rápido] Fuentes, novedades y registro actualizados; catálogo profundo omitido.');
    return;
  }

  if (!config.llm.apiKey) {
    console.log('\n[Modo sin LLM] Descubrimiento y catálogo profundo omitidos; OpenRouter queda preparado para cuando haya clave.');
    return;
  }

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
    // Priorizamos keywords de proyecto sobre páginas genéricas.
    const projectKeywords = /promo|proyect|proxect|vivienda|obra|residencial|edificio|torre|conjunto|urbanizacion|parcela|solar|suelo|cooperativa|cohousing/i;
    const contactUrl = siteUrls.find((url) => /contacto|contact/i.test(url));
    
    // Ordenar: primero las que matchean keywords de proyecto, luego las de municipio
    const scored = siteUrls.map((url) => {
      let score = 0;
      if (projectKeywords.test(url)) score += 10;
      if (areaKeywords.some((kw) => stripAccents(url).includes(kw))) score += 5;
      if (/contacto|contact|blog|noticias|news|sobre-nosotros|quienes-somos|aviso-legal|politica/i.test(url)) score -= 20;
      return { url, score };
    });
    scored.sort((a, b) => b.score - a.score);
    
    // Si el mapeo no da nada relevante, caemos a la portada.
    const relevantUrls = scored.filter((s) => s.score > 0).map((s) => s.url);
    const pagesToScrape = relevantUrls.length > 0 ? relevantUrls.slice(0, 25) : [gestora.website];

    const allPromotions = [];
    for (const pageUrl of pagesToScrape) {
      const pageMarkdown = await scrapeUrl(pageUrl);
      if (!pageMarkdown) continue;
      const promos = await extractPromotionsFromText(gestora.name, pageMarkdown);
      allPromotions.push(...promos.map((promo) => ({ ...promo, sourceUrl: pageUrl })));
    }

    if (allPromotions.length === 0) {
      console.log(`  [Catálogo] ${gestora.name}: no se encontraron promociones verificables en su web.`);
    } else {
      const existingNames = new Set(
        db.prepare('SELECT name FROM gestora_promotions WHERE gestoraId = ?')
          .all(gestora.id)
          .map((row) => slugify(row.name))
      );
      // Solo evita duplicados dentro de esta corrida. Las promociones existentes
      // también pasan por el upsert para refrescar estado, enlace y detalles.
      const seenNames = new Set();
      let added = 0;
      for (const promo of allPromotions) {
        const key = slugify(promo.nombre);
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        if (!existingNames.has(key)) added++;
        saveGestoraPromotion(db, {
          // Mismo id que el de prensa: una promoción real = una fila.
          id: `promo:${gestora.id}:${key}`,
          gestoraId: gestora.id,
          name: promo.nombre,
          // Sin ubicación literal, vacío: no asumir A Coruña (corrompe el mapa de zona).
          location: promo.location || '',
          status: promo.estado || 'Sin confirmar',
          details: promo.totalViviendas ? `${promo.totalViviendas} viviendas` : '',
          link: promo.sourceUrl,
          entregaEstimada: promo.entregaEstimada,
          buscaSocios: promo.buscaSocios,
          aportacionInicial: promo.aportacionInicial,
          precioMin: promo.precioMin,
          precioMax: promo.precioMax,
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
