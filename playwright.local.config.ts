import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser-local',
  timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5184', acceptDownloads: true },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
