import { defineConfig } from 'vite';

// base './' lets the built game run from GitHub Pages / itch.io sub-paths.
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 1500 },
});
