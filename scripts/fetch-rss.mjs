import Parser from 'rss-parser';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parser = new Parser();

const FEEDS = [
  {
    name: 'DOG — Territorio, vivienda y transporte',
    url: 'https://www.xunta.gal/diario-oficial-galicia/rssAreaTematica.jsp?area=Territorio,%20vivienda%20y%20transporte&lang=es',
  },
  {
    name: 'Contratos Públicos de Galicia — IGVS',
    url: 'https://www.contratosdegalicia.gal/rss/perfilContratante.jsp?codigoOrganismo=IGVS&lang=es',
  },
  {
    name: 'Contratos Públicos de Galicia — Xestur',
    url: 'https://www.contratosdegalicia.gal/rss/perfilContratante.jsp?codigoOrganismo=XESTUR&lang=es',
  },
];

const KEYWORDS = [
  'vivienda protegida', 'VPA', 'vivienda de protección autonómica',
  'vivienda de promoción pública', 'cooperativa', 'cooperativa de viviendas',
  'parcela', 'convenio urbanístico', 'planeamento', 'reparcelación',
  'vivienda pública', 'promoción pública', 'viviendas protegidas',
  'adjudicación', 'concurso', 'suelo residencial',
];

const MUNICIPIOS = ['A Coruña', 'Coruña, A', 'Coruña', 'coruña', 'coruna'];

const DATA_PATH = join(__dirname, '..', 'src', 'data', 'opportunities.json');

function hashItem(item) {
  return createHash('sha256').update(item.link || item.guid || item.title).digest('hex').slice(0, 16);
}

function matchesKeywords(text) {
  const lower = (text || '').toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function matchesMunicipio(text) {
  const lower = (text || '').toLowerCase();
  return MUNICIPIOS.some(m => lower.includes(m.toLowerCase()));
}

function extractDate(item) {
  const raw = item.pubDate || item.isoDate || '';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

async function main() {
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  const existing = existsSync(DATA_PATH)
    ? JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
    : [];
  const seen = new Set(existing.map(o => o.hash));

  const allItems = [];

  for (const feed of FEEDS) {
    try {
      console.log(`Fetching ${feed.name}...`);
      const data = await parser.parseURL(feed.url);
      for (const item of data.items || []) {
        const text = `${item.title || ''} ${item.contentSnippet || item.content || ''}`;
        if (!matchesKeywords(text) || !matchesMunicipio(text)) continue;
        const hash = hashItem(item);
        if (seen.has(hash)) continue;
        seen.add(hash);
        allItems.push({
          hash,
          title: (item.title || '').trim(),
          link: item.link || '',
          source: feed.name,
          date: extractDate(item),
          snippet: (item.contentSnippet || '').trim().slice(0, 300),
        });
      }
    } catch (err) {
      console.error(`Error fetching ${feed.name}:`, err.message);
    }
  }

  allItems.sort((a, b) => b.date.localeCompare(a.date));
  const merged = [...allItems, ...existing].slice(0, 200);
  writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2));
  console.log(`Saved ${merged.length} opportunities (${allItems.length} new).`);
}

main();
