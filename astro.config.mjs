// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://vivienda.jordixlab.com',
  base: '/',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: { plugins: [tailwindcss()] },
});
