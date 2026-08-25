import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:4648',
        changeOrigin: true,
      },
    },
  },
});
