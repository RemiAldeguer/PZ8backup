import { defineConfig } from '@playwright/test';
import accessConfig from './playwright.access.config';

export default defineConfig({ ...accessConfig, testMatch: 'pz7-scope.spec.ts' });
