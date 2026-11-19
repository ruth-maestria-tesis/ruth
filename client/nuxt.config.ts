import { fileURLToPath } from 'node:url';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  // SPA: auth lives in httpOnly cookies on the API origin, so pages render in the browser.
  ssr: false,
  devtools: { enabled: false },
  modules: [
    '@pinia/nuxt',
    (_options, nuxt) => {
      nuxt.hooks.hook('vite:extendConfig', (config) => {
        config.plugins?.push(vuetify({ autoImport: true }));
      });
    },
  ],
  css: ['vuetify/styles', '@mdi/font/css/materialdesignicons.css', '~/assets/main.css'],
  build: { transpile: ['vuetify'] },
  // Use the shared enums from source (the package compiles to CommonJS).
  alias: {
    '@thesis/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
  },
  app: {
    head: {
      title: 'Plataforma de Tesis de Posgrado — Universidad de Córdoba',
      htmlAttrs: { lang: 'es' },
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono&display=swap',
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:3001/api',
      // Modules not yet on the server that use local mock data (comma list, or 'all' / '').
      // Override with NUXT_PUBLIC_MOCK_MODULES.
      mockModules: 'evaluations,feedback,disputes,defenses,minutes,notifications,dashboard,external',
    },
  },
  vite: {
    vue: { template: { transformAssetUrls } },
  },
  typescript: { strict: true },
});
