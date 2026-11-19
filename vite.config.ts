import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const apiTarget = `http://127.0.0.1:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: resolve(root, 'src/web'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(root, 'src/web') },
  },
  build: {
    outDir: resolve(root, 'dist/public'),
    emptyOutDir: true,
    sourcemap: false,
    // Fonts must be files, not data: URIs, to keep the CSP simple.
    assetsInlineLimit: 0,
  },
  server: {
    proxy: { '/api': apiTarget, '/healthz': apiTarget, '/schema': apiTarget },
  },
});
