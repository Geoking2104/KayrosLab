import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/console/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: '../../backend/web/public/console',
    emptyOutDir: true,
  },
  server: {
    port: 4174,
    // personas/catalog/ (racine du dépôt) est embarqué par src/lib/console/persona-templates.ts.
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../personas/catalog', import.meta.url))] },
    proxy: { '/v1': 'http://localhost:8787' },
  },
});
