import Parser from 'rss-parser';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import iconv from 'iconv-lite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parser = new Parser({
  customFields: { item: ['description'] },
});

const HOUSING_FEEDS = [
  { name: 'CPG — IGVS', url: 'https://www.contratosdegalicia.gal/rss/perfil-14.rss' },
  { name: 'CPG — Consellería de Vivenda', url: 'https://www.contratosdegalicia.gal/rss/perfil-515.rss' },
];

const GENERAL_FEEDS = [
  { name: 'DOG — Territorio, vivienda y transporte', url: 'https://www.xunta.gal/diario-oficial-galicia/rss/Taxonomia22008_es.rss' },
  { name: 'CPG — Últimas publicaciones', url: 'https://www.contratosdegalicia.gal/rss/ultimas-publicacions.rss' },
];

const HOUSING_KEYWORDS = [
  'vivenda', 'vivienda', 'VPP', 'VPA', 'promoción pública', 'promocion publica',
  'rehabilitación', 'rehabilitacion', 'edificio', 'parcela',
  'solo', 'suelo', 'cooperativa', 'alugueiro', 'alquiler', 'realojo',
  'construción', 'construccion', 'construcción',
];

const EXCLUDE_KEYWORDS = [
  'vehículo', 'vehiculo', 'vehículos', 'vehiculos',
  'híbrido', 'hibrido', 'híbridos', 'hibridos',
  'subministración de vestiario', 'suministro de vestuario',
  'campaña sensibilización', 'campaña de sensibilización',
];

const GENERAL_KEYWORDS = [
  'vivienda protegida', 'VPA', 'vivienda de protección',
  'vivienda de promoción pública', 'VPP', 'vivenda de promoción pública',
  'vivenda protexida', 'cooperativa', 'cooperativa de viviendas',
  'cooperativa de vivendas', 'parcela', 'convenio urbanístico',
  'planeamento', 'reparcelación', 'vivienda pública',
  'promoción pública', 'viviendas protegidas', 'vivendas protexidas',
  'suelo residencial', 'solo residencial',
  'construción', 'construcción', 'edificio para', 'edificio de',
  'obras de construción', 'obras de construcción',
];

// Área metropolitana de A Coruña ciudad y alrededores inmediatos
const MUNICIPIOS = [
  'A Coruña', 'Coruña, A', 'Coruña', 'coruña', 'coruna',
  'Arteixo', 'Culleredo', 'O Burgo', 'El Burgo', 'Oleiros',
  'Perillo', 'Santa Cruz', 'Cambre', 'Sada', 'Bergondo',
];

// Municipios de fuera del área que NO queremos (evitan falsos positivos
// cuando "A Coruña" aparece como provincia)
const EXCLUDE_MUNICIPIOS = [
  'Ferrol', 'Narón', 'Naron', 'Betanzos', 'Pontedeume',
  'Santiago de Compostela', 'Santiago', 'Lugo', 'Ourense',
  'Pontevedra', 'Vigo', 'Sanxenxo', 'Ribadeo', 'Carballo',
  'Laracha', 'Noia', 'Ribeira', 'Boiro', 'Padrón', 'Padron',
  'Melide', 'Arzúa', 'Arzua', 'Ordes', 'Fene', 'Mugardos',
  'Ares', 'Cabanas', 'Miño', 'As Pontes', 'Curtis', 'Sobrado',
  'Touro', 'O Pino', 'Boqueixón', 'Boqueixon', 'Teo', 'Ames',
  'Brión', 'Brion', 'Negreira', 'Santa Comba', 'Zas', 'Mazaricos',
  'Muros', 'Outes', 'Lousame', 'Rois', 'Dodro', 'Rianxo',
  'A Pobra', 'Cerceda', 'Carral', 'Abegondo',
];

const DATA_PATH = join(__dirname, '..', 'src', 'data', 'opportunities.json');

function hashItem(item) {
  return createHash('sha256').update(item.link || item.guid || item.title).digest('hex').slice(0, 16);
}

function matchesAny(text, keywords) {
  return keywords.some(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b', 'i').test(text);
  });
}

function extractDate(item) {
  const raw = item.pubDate || item.isoDate || '';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function isExcluded(text) {
  return matchesAny(text, EXCLUDE_KEYWORDS);
}

function isOrganismPage(item) {
  const title = cleanText(item.title || '');
  const link = item.link || '';
  return link.includes('consultaOrganismo.jsp') || title.length < 20;
}

async function fetchAndParse(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let xml;
  try {
    xml = buf.toString('utf-8');
    if (xml.includes('\uFFFD') || xml.includes('Ã') || xml.includes('Ã±')) {
      xml = iconv.decode(buf, 'iso-8859-1');
    }
  } catch {
    xml = iconv.decode(buf, 'iso-8859-1');
  }
  return parser.parseString(xml);
}

async function main() {
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  const existing = existsSync(DATA_PATH)
    ? JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
    : [];
  const seen = new Set(existing.map(o => o.hash));
  const allItems = [];

  for (const feed of HOUSING_FEEDS) {
    try {
      console.log(`Fetching ${feed.name}...`);
      const data = await fetchAndParse(feed.url);
      console.log(`  Got ${data.items?.length || 0} items`);
      for (const item of data.items || []) {
        if (isOrganismPage(item)) continue;
        const title = cleanText(item.title || '');
        const snippet = cleanText(item.contentSnippet || item.content || item.description || '');
        const fullText = `${item.title || ''} ${item.contentSnippet || item.content || item.description || ''}`;
        const cleanFull = cleanText(fullText);
        if (!matchesAny(cleanFull, HOUSING_KEYWORDS)) continue;
        if (!matchesAny(item.title || '', MUNICIPIOS)) continue;
        if (matchesAny(item.title || '', EXCLUDE_MUNICIPIOS)) continue;
        if (isExcluded(cleanFull)) continue;
        const hash = hashItem(item);
        if (seen.has(hash)) continue;
        seen.add(hash);
        allItems.push({
          hash,
          title: title.slice(0, 200),
          link: item.link || '',
          source: feed.name,
          date: extractDate(item),
          snippet: snippet.slice(0, 300),
        });
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  for (const feed of GENERAL_FEEDS) {
    try {
      console.log(`Fetching ${feed.name}...`);
      const data = await fetchAndParse(feed.url);
      console.log(`  Got ${data.items?.length || 0} items`);
      for (const item of data.items || []) {
        if (isOrganismPage(item)) continue;
        const title = cleanText(item.title || '');
        const snippet = cleanText(item.contentSnippet || item.content || item.description || '');
        const text = `${title} ${snippet}`;
        if (!matchesAny(text, GENERAL_KEYWORDS)) continue;
        if (!matchesAny(text, MUNICIPIOS)) continue;
        if (matchesAny(text, EXCLUDE_MUNICIPIOS)) continue;
        if (isExcluded(text)) continue;
        const hash = hashItem(item);
        if (seen.has(hash)) continue;
        seen.add(hash);
        allItems.push({
          hash,
          title: title.slice(0, 200),
          link: item.link || '',
          source: feed.name,
          date: extractDate(item),
          snippet: snippet.slice(0, 300),
        });
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  allItems.sort((a, b) => b.date.localeCompare(a.date));
  const merged = [...allItems, ...existing].slice(0, 200);
  writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2));
  console.log(`\nSaved ${merged.length} opportunities (${allItems.length} new).`);
}

main();
