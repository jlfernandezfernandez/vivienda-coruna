import { createHash } from 'node:crypto';
import { config, AREA_LABELS } from './lib/config.mjs';
import { searchWeb, scrapeUrl, mapSite } from './lib/scraper.mjs';
import { extractWithRegex } from './lib/regex-extractor.mjs';
import {
  EXTRACTOR_VERSION,
  shouldReprocessOpportunity,
  shouldUseComplementaryExtraction,
} from './lib/extraction-policy.mjs';
import { extractHousingData, extractPromotionsFromText, validateExtractedHousingData } from './lib/llm.mjs';
import { crawlGestoraCatalog } from './lib/discovery.mjs';
import { requirePipelineWriter } from './lib/writer-lock.mjs';
import {
  getDatabase,
  saveOpportunity,
  getAllOpportunities,
  saveSource,
  saveGestoraPromotion,
} from './lib/db.mjs';
import {
  cleanText,
  detectLocation,
  detectType,
  extractPublishedAt,
  isRelevantTitle,
  isTrustedOpportunityUrl,
  normalizeUrl,
} from './lib/monitor.mjs';

const MUNICIPIOS = [
  'A Coruña', 'Arteixo', 'Culleredo', 'Oleiros', 'Cambre',
  'Sada', 'Bergondo', 'Carral', 'Abegondo',
];

const SEARCH_QUERIES = [
  'cooperativa vivienda {municipio} 2026',
  'cooperativa vivienda protegida {municipio} busca socios',
  'promoción obra nueva viviendas {municipio} 2026',
  'promotora obra nueva {municipio} promociones en venta',
  'gestora cooperativa viviendas {municipio}',
  'licencia de obras viviendas {municipio} 2026',
  'reparcelación suelo residencial {municipio}',
  'concurso de suelo vivienda {municipio}',
  'nueva promoción inmobiliaria {municipio} 2026',
];

const DELAY_MS = 2000; // 2s entre queries para no saturar Firecrawl
const MUNICIPIO_PAUSE_MS = 5000; // 5s entre municipios

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toOpportunityFromSearch(result, source, now) {
  const title = cleanText(result.title);
  if (!isRelevantTitle(title) || !isTrustedOpportunityUrl(result.url)) return null;

  const id = createHash('sha256').update(normalizeUrl(result.url)).digest('hex').slice(0, 16);

  return {
    id,
    title,
    url: normalizeUrl(result.url),
    source,
    publishedAt: extractPublishedAt(result),
    firstSeenAt: now,
    lastSeenAt: now,
    location: detectLocation(title),
    type: detectType(title),
    status: null,
    summary: cleanText(result.description || '').slice(0, 260),
    sourceKind: 'firecrawl-search',
    enriched: false,
  };
}

async function enrichOpportunity(db, item) {
  // Intentar scrapear el artículo completo para mejor contexto
  let contentToAnalyze = item.summary || '';
  if (item.url) {
    try {
      const md = await scrapeUrl(item.url);
      if (md) contentToAnalyze = md.slice(0, 10000);
    } catch { /* usar summary */ }
  }

  // Fase 1: Regex (gratis)
  const regexData = extractWithRegex(item.title + '\n' + contentToAnalyze);
  const regexFields = regexData._regexFieldsFound || 0;
  const useComplementaryExtraction = shouldUseComplementaryExtraction(regexData, item.sourceKind);

  let llmData;
  if (useComplementaryExtraction) {
    const llmResult = await extractHousingData(item.title, contentToAnalyze);
    const regexValues = Object.fromEntries(Object.entries(regexData).filter(([key, value]) => !key.startsWith('_') && value !== null && value !== undefined));
    llmData = validateExtractedHousingData({ ...llmResult, ...regexValues, llmCallFailed: llmResult.llmCallFailed }, item.title, contentToAnalyze);
    console.log(`  [Regex→LLM] ${regexFields} campos regex + LLM para "${item.title.slice(0, 50)}..."`);
  } else {
    llmData = validateExtractedHousingData({ ...regexData, llmCallFailed: false }, item.title, contentToAnalyze);
    console.log(`  [Regex] ${regexFields} campos sin LLM para "${item.title.slice(0, 50)}..."`);
  }

  saveOpportunity(db, {
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
    evidenceText: contentToAnalyze.slice(0, 10000),
    extractionMethod: useComplementaryExtraction
      ? (llmData.llmCallSkipped ? 'regex-no-llm' : 'regex+llm')
      : 'regex',
    extractorVersion: EXTRACTOR_VERSION,
    enriched: llmData.llmCallSkipped || !llmData.llmCallFailed,
  });
}

async function main() {
  requirePipelineWriter();
  const checkedAt = new Date().toISOString();
  const db = getDatabase();

  // Reintenta campos previamente rechazados o llamadas LLM transitorias. Sin esto,
  // las URLs conocidas se saltaban para siempre y un dato malo no podía recuperarse.
  const retryNoLlm = config.llm.apiKey ? " OR extractionMethod = 'regex-no-llm'" : '';
  const retryCandidates = db.prepare(`
    SELECT * FROM opportunities
    WHERE COALESCE(enriched, 0) = 0${retryNoLlm}
       OR (enriched = 1 AND precioMin IS NULL AND COALESCE(extractorVersion, '') <> ?)
    ORDER BY lastSeenAt DESC
    LIMIT 25
  `).all(EXTRACTOR_VERSION);
  // Mantener la política en una función compartida evita que la consulta y el
  // comportamiento diverjan cuando vuelva a cambiar la versión del extractor.
  const pending = retryCandidates.filter((item) => (
    !item.enriched
    || (config.llm.apiKey && item.extractionMethod === 'regex-no-llm')
    || shouldReprocessOpportunity(item)
  ));
  for (const item of pending) {
    await enrichOpportunity(db, item);
  }
  if (pending.length) console.log(`Reintentadas ${pending.length} oportunidades pendientes de enriquecimiento.`);
  if (process.env.RETRY_ONLY === '1') return;

  const seenUrls = new Set((getAllOpportunities(db, 500)).map((o) => o.url));
  let newCount = 0;

  for (const municipio of MUNICIPIOS) {
    let scanned = 0;
    let ok = true;
    for (const queryTpl of SEARCH_QUERIES) {
      const query = queryTpl.replace('{municipio}', municipio);
      const sourceName = `Firecrawl · ${municipio}`;
      try {
        const results = await searchWeb(query, 10, { strict: true });
        scanned += results.length;
        console.log(`✓ ${sourceName}: "${query}" → ${results.length} resultados`);

        for (const r of results) {
          if (seenUrls.has(r.url)) continue;
          seenUrls.add(r.url);

          const opp = toOpportunityFromSearch(r, sourceName, checkedAt);
          if (opp) {
            saveOpportunity(db, opp);
            newCount++;
            // Enriquecer inmediatamente (regex + LLM si necesario)
            await enrichOpportunity(db, opp);
          }
        }
      } catch (err) {
        ok = false;
        console.error(`✗ ${sourceName}: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    saveSource(db, {
      name: `Firecrawl · ${municipio}`,
      url: `${config.firecrawl.baseUrl}/v1/search`,
      kind: 'firecrawl-search',
      ok,
      scanned,
    });
    await sleep(MUNICIPIO_PAUSE_MS); // Pausa entre municipios
  }

  // Las búsquedas encuentran noticias y portadas, pero numerosas promociones
  // solo están enlazadas desde subpáginas del catálogo de la gestora.
  console.log('\n[Catálogos de gestoras] Buscando promociones en webs oficiales...');
  const gestoras = db.prepare("SELECT id, name, website FROM gestoras WHERE COALESCE(website, '') <> ''").all();
  let catalogPromotions = 0;
  for (const gestora of gestoras) {
    try {
      const result = await crawlGestoraCatalog(gestora, {
        mapSite,
        scrapeUrl,
        extractPromotionsFromText,
        savePromotion: (promotion) => saveGestoraPromotion(db, promotion),
      });
      catalogPromotions += result.promotionsFound;
      console.log(`  ✓ ${gestora.name}: ${result.promotionsFound} promociones verificadas en ${result.pagesScanned} páginas.`);
    } catch (error) {
      console.error(`  ✗ ${gestora.name}: ${error.message}`);
    }
  }

  const total = getAllOpportunities(db, 500).length;
  const enriched = db.prepare('SELECT count(*) as n FROM opportunities WHERE enriched=1').all()[0].n;
  console.log(`\n${newCount} nuevas desde Firecrawl Search y ${catalogPromotions} promociones verificadas en catálogos. Total: ${total} (${enriched} enriquecidas)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
