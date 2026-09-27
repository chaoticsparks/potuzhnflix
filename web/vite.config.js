// vite.config.js — builds the phone remote into web/dist, which the backend serves
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const BACKEND = process.env.BACKEND ?? 'http://localhost:8080';

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // `npm run dev:web`: hot-reloading UI on :5173 (reachable from the phone), API from the backend
  server: {
    host: true,
    proxy: {
      '/api': BACKEND,
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
});
