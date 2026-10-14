import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';

const manifestPath = process.env.PZ8_BROWSER_FIXTURE_FILE;
if (!manifestPath) throw new Error('Démarrer la fixture Java et définir PZ8_BROWSER_FIXTURE_FILE.');
const fixture = JSON.parse(readFileSync(manifestPath, 'utf8')) as { apiUrl: string };

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'pz7-access-java.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: {
    actionTimeout: 10_000,
    baseURL: 'http://127.0.0.1:3000',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000/access',
    env: { PZ8_JAVA_API_URL: fixture.apiUrl },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
