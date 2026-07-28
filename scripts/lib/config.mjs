import { env, cwd, loadEnvFile } from 'node:process';

// Root dir is the cwd both scripts and `astro build` run from; import.meta.url
// breaks here because Vite bundles this file into dist/.prerender/chunks/.
// .env is optional (CI injects env vars directly); Node 22 loads it natively.
const rootDir = cwd();
// loadEnvFile no existe en Node <20.12: guardarlo para no tragar el TypeError.
if (loadEnvFile) {
  try {
    loadEnvFile(`${rootDir}/.env`);
  } catch {
    // No .env file; rely on real environment variables.
  }
}

// Canonical list of metropolitan area municipalities (monitored zone)
export const AREA_LABELS = [
  'A Coruña',
  'Arteixo',
  'Culleredo · O Burgo',
  'Oleiros · Perillo · Santa Cruz',
  'Cambre',
  'Sada',
  'Bergondo',
  'Carral',
  'Abegondo',
];

// Expanded feeds configuration
const feeds = [
  // 1. Official Protected Housing sortitions and adjudications
  { name: 'IGVS · Adjudicaciones y sorteos', url: 'https://igvs.xunta.gal/es/vivienda-protegida/adjudicaciones-sorteos-de-vivienda-protegida', format: 'html' },
  
  // 2. Official Galician Housing Board RSS (Public Bidding)
  { name: 'IGVS · Licitaciones y contratos', url: 'https://www.contratosdegalicia.gal/rss/perfil-14.rss', format: 'rss' },
  
  // 3. Official Housing Ministry Department RSS (Galicia)
  { name: 'Consellería de Vivenda', url: 'https://www.contratosdegalicia.gal/rss/perfil-515.rss', format: 'rss' },
  
  // 4. Official Galician Gazette daily summary (Taxonomia22008_es.rss is dead since 2023; _gl variants stay fresh)
  { name: 'DOG · Sumario diario', url: 'https://www.xunta.gal/diario-oficial-galicia/rss/Sumario_gl.rss', format: 'rss' },
  
  // 5. Official Public Contracts Portal RSS (Galicia)
  { name: 'Contratos Públicos de Galicia', url: 'https://www.contratosdegalicia.gal/rss/ultimas-publicacions.rss', format: 'rss', kind: 'official' },
  
  // 6. Press: Cooperatives & Cooperative Managers (generic terms, no fixed name list — avoids bias toward known players)
  {
    name: 'Prensa · Cooperativas y Gestoras',
    url: 'https://news.google.com/rss/search?q=%28%22cooperativa+de+viviendas%22+OR+%22cooperativa+residencial%22+OR+cohousing+OR+autopromoci%C3%B3n+OR+%22gestora+de+cooperativas%22+OR+%22viviendas+de+coste%22%29+AND+%28%22A+Coru%C3%B1a%22+OR+%22La+Coru%C3%B1a%22+OR+Xux%C3%A1n+OR+Arteixo+OR+Oleiros+OR+Culleredo+OR+Cambre+OR+Sada+OR+Bergondo+OR+Carral+OR+Abegondo%29&hl=es&gl=ES&ceid=ES:es',
    format: 'rss',
    kind: 'market-alert'
  },

  // 7. Press: Obra Nueva, Developers & Licensing (generic terms, no fixed name list — avoids bias toward known players)
  {
    name: 'Prensa · Promociones y Licencias',
    url: 'https://news.google.com/rss/search?q=%28%22obra+nueva%22+OR+%22promoci%C3%B3n+residencial%22+OR+%22licencia+de+obras%22+OR+%22licencia+de+edificaci%C3%B3n%22+OR+%22reparcelaci%C3%B3n%22+OR+%22proyecto+b%C3%A1sico%22+OR+%22nueva+promotora%22%29+AND+%28%22A+Coru%C3%B1a%22+OR+%22La+Coru%C3%B1a%22+OR+Xux%C3%A1n+OR+Someso+OR+Visma+OR+Arteixo+OR+Oleiros+OR+Culleredo+OR+Cambre+OR+Sada+OR+Bergondo%29&hl=es&gl=ES&ceid=ES:es',
    format: 'rss',
    kind: 'market-alert'
  },
];

const llmApiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || null;
const llmBaseUrl = env.LLM_BASE_URL || env.OPENAI_BASE_URL || null;
const llmModel = env.LLM_MODEL || env.OPENAI_MODEL || null;

export const config = {
  paths: {
    root: rootDir,
  },
  
  llm: {
    // No proveedor implícito en producción: las tres variables deben configurarse juntas.
    apiKey: llmBaseUrl && llmModel ? llmApiKey : null,
    baseUrl: llmBaseUrl,
    model: llmModel,
  },

  firecrawl: {
    apiKey: env.FIRECRAWL_API_KEY || null,
    baseUrl: env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
  },

  // Frontend Configuration for high customization
  site: {
    title: 'Cooperativas de vivienda en A Coruña — alertas y obra nueva | Vivienda Coruña',
    description: 'Todas las cooperativas de vivienda y promociones de obra nueva del área metropolitana de A Coruña: captación de socios, plazas, licencias y vivienda protegida, detectadas a diario.',
    headerTitle: 'Cooperativas y Obra Nueva en A Coruña',
    headerSubtitle: 'Detecta señales tempranas de cooperativas de viviendas, búsqueda de socios, licencias y promociones públicas o privadas en el área metropolitana.',
  },

  feeds,
};
