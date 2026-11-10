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
      // changeOrigin: true rewrites the Host header to the API target. Without it, the
      // dev server forwards the browser's Host (the preview/tunnel host), Vite's own
      // host check then rejects the hop as a cross-origin request, and sign-in fails
      // with no useful message. The API forwards X-Forwarded-Host so its CSRF check
      // still sees the public host.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        xfwd: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host);
          });
        },
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
