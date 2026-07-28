import assert from 'node:assert/strict';
import test from 'node:test';

import { sitemapXml } from '../src/pages/sitemap.xml.js';

test('dynamic sitemap includes all backend SEO routes under the production root', () => {
  const xml = sitemapXml('https://vivienda.jordixlab.com/', {
    municipalities: ['/municipio/a-coruna'],
    opportunities: ['/oportunidad/op-1'],
    gestoras: ['/gestora/g-1'],
  });

  assert.match(xml, /https:\/\/vivienda\.jordixlab\.com\/municipio\/a-coruna/);
  assert.match(xml, /https:\/\/vivienda\.jordixlab\.com\/oportunidad\/op-1/);
  assert.match(xml, /https:\/\/vivienda\.jordixlab\.com\/gestora\/g-1/);
  assert.doesNotMatch(xml, /github\.io|vivienda-coruna\//);
});
