import { defineConfig } from '@playwright/test';
import accessConfig from './playwright.access-java.config';

export default defineConfig({ ...accessConfig, testMatch: 'pz7-scope-java.spec.ts' });
