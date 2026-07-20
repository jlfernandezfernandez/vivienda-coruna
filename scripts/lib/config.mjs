import { join } from 'node:path';
import { env, cwd } from 'node:process';
import dotenv from 'dotenv';

// Root dir is the cwd both scripts and `astro build` run from; import.meta.url
// breaks here because Vite bundles this file into dist/.prerender/chunks/.
const rootDir = cwd();
dotenv.config({ path: join(rootDir, '.env') });

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
  
  // 4. Official Galician Gazette RSS (Housing and Territory Regulations/Decisions)
  { name: 'DOG · Vivienda y territorio', url: 'https://www.xunta.gal/diario-oficial-galicia/rss/Taxonomia22008_es.rss', format: 'rss' },
  
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

export const config = {
  paths: {
    root: rootDir,
  },
  
  llm: {
    // Read OpenRouter or OpenAI keys
    apiKey: env.LLM_API_KEY || env.OPENAI_API_KEY || null,
    // Base completions URL, defaults to OpenRouter
    baseUrl: env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
    // Completion model name, defaults to gpt-4o-mini
    model: env.LLM_MODEL || env.OPENAI_MODEL || 'openai/gpt-4o-mini',
  },

  firecrawl: {
    apiKey: env.FIRECRAWL_API_KEY || null,
    baseUrl: env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
  },

  // Frontend Configuration for high customization
  site: {
    title: 'Vivienda Coruña — Monitor de cooperativas y obra nueva',
    description: 'Monitor de cooperativas, promociones nuevas y vivienda protegida en el área metropolitana de A Coruña.',
    headerTitle: 'Vivienda Protegida y Obra Nueva en A Coruña',
    headerSubtitle: 'Detecta señales tempranas de cooperativas de viviendas, búsqueda de socios, licencias y promociones públicas o privadas en el área metropolitana.',
    municipalities: [
      'A Coruña',
      'Oleiros',
      'Arteixo',
      'Culleredo',
      'Cambre',
      'Sada',
      'Bergondo',
      'Carral',
      'Abegondo',
    ],
  },

  feeds,
};
