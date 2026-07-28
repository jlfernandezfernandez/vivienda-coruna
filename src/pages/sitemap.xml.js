import { api } from '../lib/api/client.mjs';

export const prerender = false;

export function sitemapXml(base, routes) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const paths = ['/', ...routes.municipalities, ...routes.opportunities, ...routes.gestoras];
  const urls = [...new Set(paths)].map((path) => new URL(path.replace(/^\//, ''), root).toString());
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
}

export async function GET({ url }) {
  try {
    const xml = sitemapXml(new URL(import.meta.env.BASE_URL, import.meta.env.SITE).toString(), await api.seoRoutes());
    return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
  } catch (error) {
    console.error('sitemap generation failed:', error.message);
    return new Response('', { status: 503, headers: { 'retry-after': '60', 'x-robots-tag': 'noindex' } });
  }
}
