import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  build: {
    outDir: '../../backend/web/public/console',
    emptyOutDir: true,
  },
  server: {
    port: 4174,
    proxy: { '/v1': 'http://localhost:8787' },
  },
});
