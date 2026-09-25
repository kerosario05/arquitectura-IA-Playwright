import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './automations/apps/kiosko/sections/default-section/cases/preview-001-kiosko2',
  testMatch: 'case.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
});
