import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHousingData, pickOfficialWebsite, extractGestoraContactFromText, extractPromotionsFromText, isGroundedEntityName, validateExtractedHousingData } from '../scripts/lib/llm.mjs';
import { searchWeb, scrapeUrl } from '../scripts/lib/scraper.mjs';
import { config } from '../scripts/lib/config.mjs';
import { extractWithRegex } from '../scripts/lib/regex-extractor.mjs';
import { spawnSync } from 'node:child_process';

function mockOpenAiResponse(payload) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withMockedFetch(mockFn, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('extractHousingData devuelve estado y campos verificables del LLM; descarta lo no literal', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({
      precioMin: 300000, precioMax: null, habitacionesMin: 3, banosMin: null,
      promotora: 'Nozar', totalViviendas: 66, garaje: true, trastero: true, terraza: true,
      estado: 'Últimas unidades', nombrePromocion: 'Edificio Montevideo',
    }),
    async () => {
      const data = await extractHousingData('Edificio Montevideo en A Coruña', 'Nozar comercializa 66 viviendas, edificio Montevideo, últimas unidades, desde 300.000 €.');
      assert.equal(data.estado, 'Últimas unidades');
      assert.equal(data.nombrePromocion, 'Edificio Montevideo');
      assert.equal(data.promotora, 'Nozar');
    },
  );
});

test('pickOfficialWebsite descarta la web de una empresa distinta cuando el LLM dice indexMatch -1', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ indexMatch: -1 }),
    async () => {
      const url = await pickOfficialWebsite('Nozar', [
        { title: 'GESTOGAR Cooperativas de viviendas', url: 'https://www.gestogar.com/' },
      ]);
      assert.equal(url, null);
    },
  );
});

test('pickOfficialWebsite devuelve la url del índice elegido por el LLM', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ indexMatch: 1 }),
    async () => {
      const url = await pickOfficialWebsite('Nozar', [
        { title: 'GESTOGAR Cooperativas de viviendas', url: 'https://www.gestogar.com/' },
        { title: 'Nozar: Promotora Inmobiliaria de Obra nueva', url: 'https://nozar.es/' },
      ]);
      assert.equal(url, 'https://nozar.es/');
    },
  );
});

test('extractGestoraContactFromText deja vacío lo que no aparece literalmente en el texto', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ website: 'https://nozar.es', phone: '', email: '', address: '', description: 'Promotora nacional.' }),
    async () => {
      const contact = await extractGestoraContactFromText('Nozar', 'Nozar es una promotora nacional. https://nozar.es');
      assert.equal(contact.phone, '');
      assert.equal(contact.email, '');
      assert.equal(contact.website, 'https://nozar.es');
      assert.equal(contact.description, '');
    },
  );
});

test('extractPromotionsFromText devuelve [] si la web no lista promociones con nombre propio', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [] }),
    async () => {
      const promos = await extractPromotionsFromText('Carlos Luxury Realty', 'Agencia de reventa de viviendas de lujo, sin promociones propias.');
      assert.deepEqual(promos, []);
    },
  );
});

test('extractPromotionsFromText extrae el catálogo real cuando nombre y ubicación constan juntos', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [{ nombre: 'Parque de Oza', estado: 'Comercialización', location: 'A Coruña', totalViviendas: 32, entregaEstimada: null, buscaSocios: true, aportacionInicial: null }] }),
    async () => {
      const promos = await extractPromotionsFromText('Masar', 'Promoción Parque de Oza, A Coruña. 32 viviendas, en comercialización.');
      assert.equal(promos.length, 1);
      assert.equal(promos[0].nombre, 'Parque de Oza');
    },
  );
});

test('extractPromotionsFromText no atribuye A Coruña del footer a una promoción nacional', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [{ nombre: 'Residencial Pinos Altos', estado: 'En construcción', location: 'A Coruña', totalViviendas: 137, entregaEstimada: null, buscaSocios: null, aportacionInicial: null }] }),
    async () => {
      const markdown = `Residencial Pinos Altos. 137 viviendas en Cadalso de los Vidrios (Madrid).\n${'contenido '.repeat(150)}\nOficina: A Coruña`;
      const promos = await extractPromotionsFromText('Galivivienda', markdown);
      assert.deepEqual(promos, []);
    },
  );
});

test('rechaza nombres genéricos o frases aunque aparezcan literalmente', () => {
  const source = 'Anjoca compró el solar el pasado diciembre. Es un edificio de viviendas adquirido para Sada.';
  assert.equal(isGroundedEntityName('el pasado diciembre', source, 'company'), null);
  assert.equal(isGroundedEntityName('edificio de viviendas adquirido para Sada', source, 'promotion'), null);
  assert.equal(isGroundedEntityName('Anjoca', source, 'company'), 'Anjoca');
});

test('rechaza cifras, servicios y estados del LLM que no tienen evidencia literal', () => {
  const parsed = validateExtractedHousingData({
    precioMin: 999999, precioMax: null, habitacionesMin: 4, banosMin: 3,
    promotora: 'Proyecto Fantasma', totalViviendas: 999,
    garaje: true, trastero: true, terraza: true,
    estado: 'Agotada/Vendida', nombrePromocion: 'Residencial Inventado',
  }, 'Nueva promoción en Oleiros', 'Proyecto residencial pendiente de licencia.');
  assert.equal(parsed.precioMin, null);
  assert.equal(parsed.totalViviendas, null);
  assert.equal(parsed.garaje, null);
  assert.equal(parsed.estado, null);
  assert.equal(parsed.promotora, null);
  assert.equal(parsed.nombrePromocion, null);
});

test('sin clave LLM marca la extracción como omitida, no como fallo transitorio', async () => {
  const previous = config.llm.apiKey;
  config.llm.apiKey = null;
  try {
    const result = await extractHousingData('17 viviendas públicas en Culleredo', 'La Xunta licitará las obras.');
    assert.equal(result.llmCallSkipped, true);
    assert.equal(result.llmCallFailed, false);
  } finally {
    config.llm.apiKey = previous;
  }
});

test('la ventana regex no captura cifras de otra promoción al final del artículo', () => {
  const primary = 'Alborada A Chave ofrece pisos desde 210.000 euros. '.padEnd(1900, 'x');
  const secondary = ' Otras promociones: Mirador Cabancas contará con 38 viviendas.';
  const result = extractWithRegex(primary + secondary);
  assert.equal(result.precioMin, 210000);
  assert.equal(result.totalViviendas, null);
});

test('no interpreta toneladas o metros cuadrados como precios', () => {
  assert.equal(extractWithRegex('Proyecto desde 300.000 metros cuadrados').precioMin, null);
  assert.equal(extractWithRegex('Inversión entre 100.000 y 250.000 toneladas').precioMin, null);
  assert.equal(extractWithRegex('Viviendas desde 210.000 euros').precioMin, 210000);
});

test('no valida un servicio positivo cuando la fuente dice sin servicio', () => {
  const source = 'Viviendas sin garaje, sin trastero y sin terraza.';
  const positive = validateExtractedHousingData({ garaje: true, trastero: true, terraza: true }, '', source);
  assert.equal(positive.garaje, null);
  assert.equal(positive.trastero, null);
  assert.equal(positive.terraza, null);
  const negative = validateExtractedHousingData({ garaje: false, trastero: false, terraza: false }, '', source);
  assert.equal(negative.garaje, false);
  assert.equal(negative.trastero, false);
  assert.equal(negative.terraza, false);
});

test('no asigna una cifra a un campo solo porque aparezca en otro contexto', () => {
  const source = 'Inversión de 300.000 euros, edificio de 3 plantas con 66 plazas de garaje.';
  const parsed = validateExtractedHousingData({ precioMin: 300000, habitacionesMin: 3, totalViviendas: 66 }, '', source);
  assert.equal(parsed.precioMin, null);
  assert.equal(parsed.habitacionesMin, null);
  assert.equal(parsed.totalViviendas, null);
});

test('totalViviendas se sustenta en el cuerpo aunque el título no mencione la cifra', () => {
  const title = 'Oleiros abre el plazo para apuntarse a la cooperativa de la promoción Xardíns da Rabadeira';
  const body = 'Sobre ellas se levantarán en total 26 viviendas, 20 de protección y 6 a precio libre.';
  const parsed = validateExtractedHousingData({ totalViviendas: 26 }, title, body);
  assert.equal(parsed.totalViviendas, 26);
});

test('no atribuye la dirección de una oficina cercana a la promoción', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [{
      nombre: 'Residencial Pinos Altos', estado: null, location: 'A Coruña',
      totalViviendas: 137, entregaEstimada: null, buscaSocios: null, aportacionInicial: null,
    }] }),
    async () => {
      const result = await extractPromotionsFromText('Gestora Nacional', 'Residencial Pinos Altos. Proyecto de 137 viviendas en Madrid. Oficina: A Coruña.');
      assert.deepEqual(result, []);
    },
  );
});

test('bloquea escritores directos fuera del wrapper con mutex', () => {
  const env = { ...process.env };
  delete env.VIVIENDA_PIPELINE_LOCKED;
  const run = spawnSync(process.execPath, ['scripts/repair-opportunity-grounding.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}${run.stderr}`, /Escritor directo bloqueado/);
});

test('no mezcla ubicación ni cifras de la siguiente promoción del catálogo', async () => {
  await withMockedFetch(
    async () => mockOpenAiResponse({ promociones: [
      { nombre: 'Residencial Norte', estado: null, location: 'A Coruña', totalViviendas: 80, entregaEstimada: null, buscaSocios: null, aportacionInicial: null },
      { nombre: 'Parque de Oza', estado: 'En construcción', location: 'A Coruña', totalViviendas: 32, entregaEstimada: '2027', buscaSocios: null, aportacionInicial: null },
    ] }),
    async () => {
      const markdown = 'Residencial Norte. 80 viviendas en Madrid.\n## Parque de Oza\nA Coruña. 32 viviendas en construcción. Entrega 2027.';
      const promos = await extractPromotionsFromText('Gestora', markdown);
      assert.deepEqual(promos.map((promo) => promo.nombre), ['Parque de Oza']);
      assert.equal(promos[0].totalViviendas, 32);
      assert.equal(promos[0].entregaEstimada, '2027');
    },
  );
});

test('searchWeb devuelve [] si Firecrawl responde con error, sin lanzar excepción', async () => {
  await withMockedFetch(
    async () => new Response('', { status: 500 }),
    async () => {
      const results = await searchWeb('cualquier cosa');
      assert.deepEqual(results, []);
    },
  );
});

test('scrapeUrl devuelve null si Firecrawl falla, sin lanzar excepción', async () => {
  await withMockedFetch(
    async () => new Response('', { status: 500 }),
    async () => {
      const markdown = await scrapeUrl('https://example.com');
      assert.equal(markdown, null);
    },
  );
});
