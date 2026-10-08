import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // pdfjs-dist's worker is shipped as .mjs and breaks Vite's dep pre-bundler;
  // skip optimization so it loads as native ESM at runtime.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
