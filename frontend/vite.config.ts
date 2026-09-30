import { defineConfig } from 'vite';

const apiProxy = { '/api': { target: process.env.LILAC_API || 'http://localhost:4600', changeOrigin: true } };
const safetyHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' };

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LILAC_FE_PORT) || 5180,
    strictPort: true,
    headers: safetyHeaders,
    // Sandbox filesystem events are unreliable; polling keeps HMR current.
    watch: { usePolling: true, interval: 400 },
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.LILAC_PREVIEW_PORT) || 5241,
    strictPort: true,
    headers: safetyHeaders,
    proxy: apiProxy,
  },
  build: { sourcemap: false },
});
