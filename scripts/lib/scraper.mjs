import { config } from './config.mjs';

// Todo (scrape / map / search) va por Firecrawl. URL base en config.firecrawl.baseUrl
// (env FIRECRAWL_BASE_URL, por defecto la API oficial). Token opcional: la instancia
// self-hosted puede ir sin key; la API oficial la necesita.

async function firecrawl(path, body, timeoutMs) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.firecrawl.apiKey) headers.Authorization = `Bearer ${config.firecrawl.apiKey}`;
  const response = await fetch(`${config.firecrawl.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    console.warn(`[firecrawl] ${path} → HTTP ${response.status}`);
    return null;
  }
  return response.json();
}

// Cloudflare ofusca emails: el markdown trae "[email protected]" y el email real
// va cifrado en un atributo data-cfemail del html. Lo desciframos y reponemos.
function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let email = '';
  for (let i = 2; i < hex.length; i += 2) {
    email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return email;
}

function deobfuscateCfEmails(markdown, html) {
  const placeholder = /\\?\[email\s+protected\\?\]/gi;
  if (!html || !placeholder.test(markdown)) return markdown;
  const emails = [...html.matchAll(/data-cfemail="([0-9a-fA-F]+)"/g)].map((m) => decodeCfEmail(m[1]));
  let i = 0;
  return markdown.replace(placeholder, () => emails[i++] ?? '[email protected]');
}

/** Scrapes a URL to markdown, or null. */
export async function scrapeUrl(url) {
  try {
    const json = await firecrawl('/v1/scrape', { url, formats: ['markdown', 'html'] }, 45_000);
    const markdown = json?.data?.markdown;
    if (!markdown) return null;
    return deobfuscateCfEmails(markdown, json.data.html);
  } catch (error) {
    console.warn(`[firecrawl] Error al raspar ${url}: ${error.message}`);
    return null;
  }
}

/** Same-origin URLs found on a site (project pages aren't usually on the homepage), or []. */
export async function mapSite(url) {
  try {
    const json = await firecrawl('/v1/map', { url }, 45_000);
    const origin = new URL(url).origin;
    return (json?.links || []).filter((u) => u.startsWith(origin));
  } catch (error) {
    console.warn(`[firecrawl] Error al mapear ${url}: ${error.message}`);
    return [];
  }
}

/** Web search for a company's real pages, or []. */
export async function searchWeb(query, limit = 3) {
  try {
    const json = await firecrawl('/v1/search', { query, limit }, 20_000);
    return (json?.data || []).map((r) => ({ url: r.url, title: r.title }));
  } catch (error) {
    console.warn(`[firecrawl] Error al buscar "${query}": ${error.message}`);
    return [];
  }
}
