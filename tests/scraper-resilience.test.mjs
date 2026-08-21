import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { config } from '../scripts/lib/config.mjs';
import { scrapeUrl, mapSite, searchWeb, fetchText } from '../scripts/lib/scraper.mjs';
import Parser from 'rss-parser';

// Helper to launch a lightweight mock HTTP server with instant teardown
function createMockServer(handler) {
  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => {
          server.closeAllConnections?.();
          return new Promise((res) => server.close(res));
        },
      });
    });
    server.on('error', reject);
  });
}

// ── TIER 1: Category-Partition Tests ────────────────────────────────────────

test('Tier 1: fetchText strips script, style and HTML markup and normalizes whitespace', async () => {
  const mockServer = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: sans-serif; color: #333; }
            .hidden { display: none; }
          </style>
          <script>
            function alertUser() { console.log('ignore script content'); }
          </script>
        </head>
        <body>
          <header><h1>Viviendas de Protección Oficial</h1></header>
          <main>
            <p>Convocatoria de sorteo en <strong>Xuxán (A Coruña)</strong>.</p>
            <p>Plazo de solicitud abierto.</p>
          </main>
          <script src="/analytics.js"></script>
        </body>
      </html>
    `);
  });

  try {
    const text = await fetchText(`${mockServer.baseUrl}/anuncio-dog`);
    assert.ok(text, 'Text should be extracted');
    assert.doesNotMatch(text, /font-family/, 'Style content must be removed');
    assert.doesNotMatch(text, /alertUser/, 'Script content must be removed');
    assert.match(text, /Viviendas de Protección Oficial/);
    assert.match(text, /Xuxán \(A Coruña\)/);
    assert.match(text, /Plazo de solicitud abierto/);
    assert.ok(!text.includes('  '), 'Whitespace should be collapsed');
  } finally {
    await mockServer.close();
  }
});

test('Tier 1: fetchText returns null on HTTP 404 or 500 without throwing uncaught exceptions', async () => {
  const mockServer = await createMockServer((req, res) => {
    if (req.url === '/not-found') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  try {
    const res404 = await fetchText(`${mockServer.baseUrl}/not-found`);
    assert.equal(res404, null, 'HTTP 404 must return null');

    const res500 = await fetchText(`${mockServer.baseUrl}/server-error`);
    assert.equal(res500, null, 'HTTP 500 must return null');
  } finally {
    await mockServer.close();
  }
});

// ── TIER 2: Boundary & Corner Cases ──────────────────────────────────────────

test('Tier 2: fetchText handles timeout gracefully with AbortSignal', async () => {
  const mockServer = await createMockServer((_req, res) => {
    // Deliberately delay response longer than timeout
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>Too late</p>');
    }, 500);
  });

  try {
    const start = Date.now();
    // Test with a fast 50ms timeout
    const result = await fetchText(`${mockServer.baseUrl}/slow`, 50);
    const elapsed = Date.now() - start;

    assert.equal(result, null, 'Timed out request must return null');
    assert.ok(elapsed < 400, `Request should abort quickly on timeout (took ${elapsed}ms)`);
  } finally {
    await mockServer.close();
  }
});

test('Tier 2: scrapeUrl deobfuscates Cloudflare protected emails from data-cfemail attribute', async () => {
  const email = 'info@coruna.es';
  const key = 0x42;
  let hex = key.toString(16).padStart(2, '0');
  for (let i = 0; i < email.length; i++) {
    hex += (email.charCodeAt(i) ^ key).toString(16).padStart(2, '0');
  }

  const originalBaseUrl = config.firecrawl.baseUrl;
  const mockServer = await createMockServer((req, res) => {
    if (req.url === '/v1/scrape') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          markdown: 'Contacto: [email protected] para información de pisos.',
          html: `<p>Contacto: <a class="__cf_email__" href="/cdn-cgi/l/email-protection" data-cfemail="${hex}">[email protected]</a></p>`,
        },
      }));
    }
  });

  config.firecrawl.baseUrl = mockServer.baseUrl;

  try {
    const result = await scrapeUrl('https://example.test/contacto');
    assert.ok(result, 'Scraped markdown should be returned');
    assert.match(result, /Contacto: info@coruna\.es para información/, 'Email must be deobfuscated');
    assert.doesNotMatch(result, /\[email protected\]/, 'Placeholder must be replaced');
  } finally {
    config.firecrawl.baseUrl = originalBaseUrl;
    await mockServer.close();
  }
});

test('Tier 2: mapSite filters out cross-origin URLs and handles empty/error responses', async () => {
  const originalBaseUrl = config.firecrawl.baseUrl;
  const mockServer = await createMockServer((req, res) => {
    if (req.url === '/v1/map') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        links: [
          'https://gestora-coruna.test/promociones',
          'https://gestora-coruna.test/contacto',
          'https://gestora-coruna.test.evil.example/phishing',
          'not a valid URL',
          'https://external-social-media.com/gestora',
          'https://another-domain.test/ad',
          'https://gestora-coruna.test/promociones/xuxan',
        ],
      }));
    }
  });

  config.firecrawl.baseUrl = mockServer.baseUrl;

  try {
    const links = await mapSite('https://gestora-coruna.test');
    assert.equal(links.length, 3, 'Must retain only same-origin URLs');
    assert.ok(links.every((u) => u.startsWith('https://gestora-coruna.test')));
    assert.ok(!links.some((u) => u.includes('external-social-media.com')));
    assert.ok(!links.some((u) => u.includes('evil.example')));
  } finally {
    config.firecrawl.baseUrl = originalBaseUrl;
    await mockServer.close();
  }
});

// ── TIER 3: Cross-Feature Combinations ──────────────────────────────────────

test('Tier 3: searchWeb distinguishes strict mode error propagation from non-strict graceful fallback', async () => {
  const originalBaseUrl = config.firecrawl.baseUrl;
  const mockServer = await createMockServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service Unavailable' }));
  });

  config.firecrawl.baseUrl = mockServer.baseUrl;

  try {
    // Non-strict mode: logs warning and returns empty array []
    const nonStrictResults = await searchWeb('cooperativas coruna', 3, { strict: false });
    assert.deepEqual(nonStrictResults, []);

    // Strict mode: throws exception for caller to handle
    await assert.rejects(
      async () => {
        await searchWeb('cooperativas coruna', 3, { strict: true });
      },
      /Firecrawl \/v1\/search: HTTP 503|503/i
    );
  } finally {
    config.firecrawl.baseUrl = originalBaseUrl;
    await mockServer.close();
  }
});

test('Tier 3: RSS parser resilience: handles Latin-1 charset with accented characters', async () => {
  const parser = new Parser({ customFields: { item: ['description'] } });

  // XML with ISO-8859-1 encoded characters ("A Coruña", "Construcción")
  const latin1Xml = Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0">
  <channel>
    <title>Novas de Vivenda</title>
    <link>https://example.test</link>
    <description>Novas</description>
    <item>
      <title>Nova promoción en A Coru\xF1a</title>
      <link>https://example.test/item-1</link>
      <pubDate>Fri, 21 Aug 2026 10:00:00 GMT</pubDate>
      <description>Construcci\xF3n de vivendas protexidas.</description>
    </item>
  </channel>
</rss>`, 'latin1');

  let xmlStr = latin1Xml.toString('utf8');
  if (xmlStr.includes('\uFFFD')) {
    xmlStr = latin1Xml.toString('latin1');
  }

  const parsed = await parser.parseString(xmlStr);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, 'Nova promoción en A Coruña');
  assert.equal(parsed.items[0].description, 'Construcción de vivendas protexidas.');
});

// ── TIER 4: Real-World Scenarios ─────────────────────────────────────────────

test('Tier 4: IGVS listing parser extracts adjudication links, dates, and titles robustly', () => {
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

  const sourceUrl = 'https://igvs.xunta.gal/vivenda-protexida';
  const sampleHtml = `
    <div class="listado">
      <!-- Valid item 1 -->
      <a href="/adjudicaciones-sorteos-de-vivienda-protegida/sorteo-xuxan-2026">
        <span>21/08/2026</span> Sorteo de 40 vivendas de promoción pública no barrio de Xuxán (A Coruña)
      </a>

      <!-- Valid item 2 with nested tags -->
      <a href="/adjudicaciones-sorteos-de-vivienda-protegida/adxudicacion-oleiros">
        <strong>15/07/2026</strong> <em>Adxudicación definitiva en Oleiros</em>
      </a>

      <!-- Irrelevant link without target path -->
      <a href="/outras-novas/aviso-legal">
        10/08/2026 Aviso legal
      </a>

      <!-- Target path link missing date prefix -->
      <a href="/adjudicaciones-sorteos-de-vivienda-protegida/sen-data">
        Convocatoria sen data inicial
      </a>
    </div>
  `;

  const parsedItems = parseIgvsListing(sampleHtml, sourceUrl);
  assert.equal(parsedItems.length, 2, 'Should extract only the 2 valid housing adjudication listings');

  assert.equal(parsedItems[0].pubDate, '21/08/2026');
  assert.equal(parsedItems[0].title, 'Sorteo de 40 vivendas de promoción pública no barrio de Xuxán (A Coruña)');
  assert.equal(parsedItems[0].link, 'https://igvs.xunta.gal/adjudicaciones-sorteos-de-vivienda-protegida/sorteo-xuxan-2026');

  assert.equal(parsedItems[1].pubDate, '15/07/2026');
  assert.equal(parsedItems[1].title, 'Adxudicación definitiva en Oleiros');
  assert.equal(parsedItems[1].link, 'https://igvs.xunta.gal/adjudicaciones-sorteos-de-vivienda-protegida/adxudicacion-oleiros');
});
