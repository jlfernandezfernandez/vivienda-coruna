// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jlfernandezfernandez.github.io',
  base: '/vivienda-coruna',
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
});
