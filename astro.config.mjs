// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://jlfernandezfernandez.github.io',
  base: '/vpa-monitor',
  vite: { plugins: [tailwindcss()] },
});
