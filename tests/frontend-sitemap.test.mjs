import assert from 'node:assert/strict';
import test from 'node:test';

import { sitemapXml } from '../src/pages/sitemap.xml.js';

test('dynamic sitemap includes all backend SEO routes under the application base path', () => {
  const xml = sitemapXml('https://example.test/vivienda-coruna/', {
    municipalities: ['/municipio/a-coruna'],
    opportunities: ['/oportunidad/op-1'],
    gestoras: ['/gestora/g-1'],
  });

  assert.match(xml, /https:\/\/example\.test\/vivienda-coruna\/municipio\/a-coruna/);
  assert.match(xml, /https:\/\/example\.test\/vivienda-coruna\/oportunidad\/op-1/);
  assert.match(xml, /https:\/\/example\.test\/vivienda-coruna\/gestora\/g-1/);
});
