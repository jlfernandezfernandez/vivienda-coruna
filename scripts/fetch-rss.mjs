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
  { name: 'IGVS', url: 'https://www.contratosdegalicia.gal/rss/perfil-14.rss' },
  { name: 'Consellería de Vivenda', url: 'https://www.contratosdegalicia.gal/rss/perfil-515.rss' },
  { name: 'DOG · Vivienda y territorio', url: 'https://www.xunta.gal/diario-oficial-galicia/rss/Taxonomia22008_es.rss' },
  { name: 'Contratos Públicos de Galicia', url: 'https://www.contratosdegalicia.gal/rss/ultimas-publicacions.rss' },
];

async function loadPrevious() {
  try {
    const parsed = JSON.parse(await readFile(dataPath, 'utf8'));
    return Array.isArray(parsed?.items) ? parsed : { items: [] };
  } catch {
    return { items: [] };
  }
}

async function parseFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
