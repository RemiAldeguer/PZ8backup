import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/cloudflare-browser',
  outputDir: './test-results/cloudflare-browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:8787',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node_modules/.bin/tsx scripts/cloudflare-e2e-server.ts',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      XDG_CONFIG_HOME: '/tmp/planzone8-playwright-cloudflare-config',
      WRANGLER_LOG_PATH: '/tmp/planzone8-playwright-cloudflare-logs',
      WRANGLER_SEND_METRICS: 'false',
    },
  },
});
