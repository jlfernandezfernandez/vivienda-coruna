import Parser from 'rss-parser';
import iconv from 'iconv-lite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AREA_LABELS,
  mergeOpportunities,
  toOpportunity,
} from './lib/monitor.mjs';

const parser = new Parser({ customFields: { item: ['description'] } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'src', 'data', 'monitor.json');

const feeds = [
  { name: 'IGVS · Adjudicaciones y sorteos', url: 'https://igvs.xunta.gal/es/vivienda-protegida/adjudicaciones-sorteos-de-vivienda-protegida', format: 'html' },
  { name: 'IGVS', url: 'https://www.contratosdegalicia.gal/rss/perfil-14.rss', format: 'rss' },
  { name: 'Consellería de Vivenda', url: 'https://www.contratosdegalicia.gal/rss/perfil-515.rss', format: 'rss' },
  { name: 'DOG · Vivienda y territorio', url: 'https://www.xunta.gal/diario-oficial-galicia/rss/Taxonomia22008_es.rss', format: 'rss' },
  { name: 'Contratos Públicos de Galicia', url: 'https://www.contratosdegalicia.gal/rss/ultimas-publicacions.rss', format: 'rss' },
];

async function loadPrevious() {
  try {
    const parsed = JSON.parse(await readFile(dataPath, 'utf8'));
    return Array.isArray(parsed?.items) ? parsed : { items: [] };
  } catch {
    return { items: [] };
  }
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
  if (xml.includes('\uFFFD') || xml.includes('Ã')) xml = iconv.decode(buffer, 'latin1');
  const parsed = await parser.parseString(xml);
  return parsed.items || [];
}

async function main() {
  const checkedAt = new Date().toISOString();
  const previous = await loadPrevious();
  const results = await Promise.allSettled(feeds.map(parseFeed));
  const sources = [];
  const candidates = [];

  results.forEach((result, index) => {
    const feed = feeds[index];
    if (result.status === 'fulfilled') {
      const relevant = result.value
        .map((item) => toOpportunity(item, feed.name, checkedAt))
        .filter(Boolean);
      candidates.push(...relevant);
      sources.push({ name: feed.name, url: feed.url, ok: true, scanned: result.value.length });
      console.log(`✓ ${feed.name}: ${result.value.length} revisados, ${relevant.length} relevantes`);
      return;
    }

    sources.push({ name: feed.name, url: feed.url, ok: false, scanned: 0 });
    console.error(`✗ ${feed.name}: ${result.reason?.message || 'error desconocido'}`);
  });

  if (!sources.some((source) => source.ok)) {
    throw new Error('No se pudo consultar ninguna fuente; se conservan los datos anteriores');
  }

  const items = mergeOpportunities(candidates, previous.items || [], checkedAt);
  const monitor = { checkedAt, area: AREA_LABELS, sources, items };
  await writeFile(dataPath, `${JSON.stringify(monitor, null, 2)}\n`);
  console.log(`\n${items.length} oportunidades guardadas en el área objetivo.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
