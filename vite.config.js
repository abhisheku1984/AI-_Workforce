import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: false,
    // Preview environment proxies through a *.e2b.app host; allow any host/origin.
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
