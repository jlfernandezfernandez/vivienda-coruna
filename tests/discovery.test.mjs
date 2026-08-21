import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCOVERY_RESULT_LIMIT,
  GESTORA_DISCOVERY_QUERIES,
  selectCatalogUrls,
  crawlGestoraCatalog,
} from '../scripts/lib/discovery.mjs';

test('el descubrimiento cubre promotoras, gestoras y cooperativas en toda el área metropolitana', () => {
  assert.ok(DISCOVERY_RESULT_LIMIT >= 15, 'cada búsqueda debe superar el límite superficial anterior de 10');
  assert.ok(GESTORA_DISCOVERY_QUERIES.length >= 8, 'debe haber variedad suficiente de consultas');

  const corpus = GESTORA_DISCOVERY_QUERIES.join('\n').toLowerCase();
  for (const term of ['promotora', 'gestora', 'cooperativa', 'a coruña', 'arteixo', 'oleiros', 'culleredo', 'cambre', 'sada']) {
    assert.match(corpus, new RegExp(term), `falta cobertura explícita para ${term}`);
  }
  assert.match(corpus, /galicia|galega/, 'debe buscar también entidades que se presentan con ámbito gallego');
});

test('la selección de catálogo prioriza páginas de proyectos y conserva la portada como respaldo', () => {
  const website = 'https://promotora.example/';
  const selected = selectCatalogUrls([
    'https://promotora.example/contacto',
    'https://promotora.example/aviso-legal',
    'https://promotora.example/promociones/residencial-marineda-a-coruna',
    'https://promotora.example/obra-nueva/oleiros',
    'https://promotora.example/proyectos',
    'https://otra.example/promociones/culleredo',
  ], website, 4);

  assert.deepEqual(new Set(selected.slice(0, 2)), new Set([
    'https://promotora.example/promociones/residencial-marineda-a-coruna',
    'https://promotora.example/obra-nueva/oleiros',
  ]));
  assert.ok(selected.includes(website));
  assert.ok(!selected.some((url) => /contacto|aviso-legal/.test(url)));
  assert.ok(selected.every((url) => new URL(url).origin === new URL(website).origin));
});

test('el rastreo de una gestora guarda promociones nuevas de subpáginas y elimina duplicados', async () => {
  const saved = [];
  const scraped = [];
  const gestora = { id: 'promotora-nova', name: 'Promotora Nova', website: 'https://nova.example/' };

  const result = await crawlGestoraCatalog(gestora, {
    mapSite: async () => [
      'https://nova.example/contacto',
      'https://nova.example/promociones/torres-de-oza-a-coruna',
      'https://nova.example/proyectos/residencial-ria-do-burgo-culleredo',
    ],
    scrapeUrl: async (url) => {
      scraped.push(url);
      return `Catálogo verificable de ${url}`;
    },
    extractPromotionsFromText: async (_name, _markdown, url) => url.includes('torres-de-oza')
      ? [{ nombre: 'Torres de Oza', location: 'A Coruña', estado: 'Comercialización', totalViviendas: 24 }]
      : url.includes('ria-do-burgo')
        ? [
            { nombre: 'Residencial Ría do Burgo', location: 'Culleredo', estado: null, precioMin: 210000 },
            { nombre: 'Residencial Ría do Burgo', location: 'Culleredo', estado: null, precioMin: 210000 },
          ]
        : [],
    savePromotion: (promotion) => saved.push(promotion),
  }, { maxPages: 6 });

  assert.equal(result.promotionsFound, 2);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map((p) => p.id), [
    'promo:promotora-nova:torres-de-oza',
    'promo:promotora-nova:residencial-r-a-do-burgo',
  ]);
  assert.equal(saved[0].link, 'https://nova.example/promociones/torres-de-oza-a-coruna');
  assert.equal(saved[0].details, '24 viviendas');
  assert.ok(scraped.includes('https://nova.example/'));
  assert.ok(!scraped.some((url) => url.includes('contacto')));
});
