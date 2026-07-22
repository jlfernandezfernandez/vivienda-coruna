import { createHash } from 'node:crypto';
import { config, AREA_LABELS } from './lib/config.mjs';
import { searchWeb, scrapeUrl } from './lib/scraper.mjs';
import { extractWithRegex } from './lib/regex-extractor.mjs';
import { extractHousingData } from './lib/llm.mjs';
import {
  getDatabase,
  saveOpportunity,
  getAllOpportunities,
} from './lib/db.mjs';
import {
  cleanText,
  detectLocation,
  detectType,
  isRelevantTitle,
  normalizeUrl,
} from './lib/monitor.mjs';

const MUNICIPIOS = [
  'A Coruña', 'Arteixo', 'Culleredo', 'Oleiros', 'Cambre',
  'Sada', 'Bergondo', 'Carral', 'Abegondo',
];

const SEARCH_QUERIES = [
  'cooperativa vivienda {municipio} 2026',
  'promoción obra nueva viviendas {municipio} 2026',
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
  if (!isRelevantTitle(title)) return null;

  const id = createHash('sha256').update(normalizeUrl(result.url)).digest('hex').slice(0, 16);

  return {
    id,
    title,
    url: normalizeUrl(result.url),
    source,
    publishedAt: null,
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

  let llmData;
  if (regexData._llmNeeded) {
    llmData = await extractHousingData(item.title, contentToAnalyze);
    console.log(`  [Regex→LLM] ${regexFields} campos regex + LLM para "${item.title.slice(0, 50)}..."`);
  } else {
    llmData = { ...regexData, llmCallFailed: false };
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
    status: llmData.estado || item.status,
    nombrePromocion: llmData.nombrePromocion,
    enriched: !llmData.llmCallFailed,
  });
}

async function main() {
  const checkedAt = new Date().toISOString();
  const db = getDatabase();
  const seenUrls = new Set((getAllOpportunities(db, 500)).map((o) => o.url));
  let newCount = 0;

  for (const municipio of MUNICIPIOS) {
    for (const queryTpl of SEARCH_QUERIES) {
      const query = queryTpl.replace('{municipio}', municipio);
      const sourceName = `Firecrawl · ${municipio}`;
      try {
        const results = await searchWeb(query, 5);
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
        console.error(`✗ ${sourceName}: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    await sleep(MUNICIPIO_PAUSE_MS); // Pausa entre municipios
  }

  const total = getAllOpportunities(db, 500).length;
  const enriched = db.prepare('SELECT count(*) as n FROM opportunities WHERE enriched=1').all()[0].n;
  console.log(`\n${newCount} nuevas desde Firecrawl Search. Total: ${total} (${enriched} enriquecidas)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
