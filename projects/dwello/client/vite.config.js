import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 4200,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4201' },
  },
  preview: { host: '127.0.0.1', port: 4200, strictPort: true },
});
