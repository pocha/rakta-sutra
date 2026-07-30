import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    // src/lib/parser.js imports the shared parser-core.mjs from the repo
    // root (one level above this project) — allow the dev server to serve it.
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  // package.json's version is already the single source of truth for
  // versionName/MARKETING_VERSION (see deploy.sh) — reuse it for the
  // in-app display too instead of a second place to keep in sync.
  define: { __APP_VERSION__: JSON.stringify(version) },
});
