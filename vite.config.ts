import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/v1': process.env.PZ8_JAVA_API_URL || 'http://127.0.0.1:8080',
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
