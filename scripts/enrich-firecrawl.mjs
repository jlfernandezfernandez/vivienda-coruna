import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  AREA_LABELS,
  cleanText,
  detectLocation,
  detectType,
  isRelevantTitle,
  mergeOpportunities,
  normalizeUrl,
} from './lib/monitor.mjs';

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || 'http://192.168.0.112:3002';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'src', 'data', 'monitor.json');

const MUNICIPIOS = [
  'A Coruña', 'Arteixo', 'Culleredo', 'Oleiros', 'Cambre',
  'Sada', 'Bergondo', 'Carral', 'Abegondo',
];

const SEARCH_QUERIES = [
  'cooperativa vivienda {municipio} 2026',
  'promoción obra nueva viviendas {municipio} 2026',
  'vivienda protegida VPA {municipio} 2026',
  'cohousing autopromoción {municipio}',
];

async function firecrawlSearch(query, limit = 5) {
  const res = await fetch(`${FIRECRAWL_URL}/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((r) => ({ title: r.title, url: r.url, description: r.description || '' }));
}

async function firecrawlScrape(url) {
  const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return '';
  const json = await res.json();
  return json?.data?.markdown || '';
}

function extractSummary(markdown, maxLen = 260) {
  const text = cleanText(markdown);
  // Saltar navegación, menús, pies de página
  const lines = text.split('\n').filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (/^(saltar|ir a|compartir|suscr[ií]bete|inicia sesi[oó]n|men[uú]|footer|header)/i.test(t)) return false;
    if (t.length < 20) return false;
    return true;
  });
  return lines.slice(0, 5).join(' ').slice(0, maxLen);
}

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
    summary: cleanText(result.description).slice(0, 260),
    sourceKind: 'firecrawl-search',
  };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const previous = JSON.parse(await readFile(dataPath, 'utf8'));
  const candidates = [];
  const sources = [];
  const seenUrls = new Set();

  // Search across all municipios + queries
  for (const municipio of MUNICIPIOS.slice(0, 4)) { // Limitar a 4 municipios para no saturar
    for (const queryTpl of SEARCH_QUERIES.slice(0, 2)) { // 2 queries por municipio
      const query = queryTpl.replace('{municipio}', municipio);
      const sourceName = `Firecrawl · ${municipio}`;
      try {
        const results = await firecrawlSearch(query, 3);
        console.log(`✓ ${sourceName}: "${query}" → ${results.length} resultados`);

        for (const r of results) {
          if (seenUrls.has(r.url)) continue;
          seenUrls.add(r.url);

          const opp = toOpportunityFromSearch(r, sourceName, checkedAt);
          if (opp) {
            // Intentar scrapear para mejor summary
            try {
              const md = await firecrawlScrape(r.url);
              if (md) {
                const betterSummary = extractSummary(md);
                if (betterSummary.length > opp.summary.length) {
                  opp.summary = betterSummary;
                }
              }
            } catch {
              // Usar el summary del search
            }
            candidates.push(opp);
          }
        }
      } catch (err) {
        console.error(`✗ ${sourceName}: ${err.message}`);
      }
    }
  }

  if (candidates.length === 0) {
    console.log('Sin resultados nuevos de Firecrawl. Conservando datos anteriores.');
    return;
  }

  const items = mergeOpportunities([...candidates, ...(previous.items || [])], [], checkedAt);
  const monitor = {
    checkedAt,
    area: AREA_LABELS,
    sources: [...previous.sources, ...sources],
    items,
  };

  await writeFile(dataPath, `${JSON.stringify(monitor, null, 2)}\n`);
  console.log(`\n${candidates.length} nuevas oportunidades desde Firecrawl. Total: ${items.length}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
