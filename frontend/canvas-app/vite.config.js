import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      // Le coeur est consomme TEL QUEL par le navigateur : aucune copie, aucun
      // portage. C'est la promesse de `core/` (ESM, zero dependance).
      '@core': fileURLToPath(new URL('../../core', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // `FileCanvasRepository` charge `node:fs/promises` dynamiquement ; ce chemin
    // n'est jamais emprunte cote navigateur, mais Rollup tenterait de le resoudre.
    rollupOptions: { external: [/^node:/] },
  },
  server: { proxy: { '/v1': 'http://localhost:8787' } },
});
