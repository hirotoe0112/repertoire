import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` 中は API を wrangler dev (8787) へ流す
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
