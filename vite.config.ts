import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: { port: 5173, strictPort: true, headers: isolationHeaders },
  preview: { headers: isolationHeaders },
});
