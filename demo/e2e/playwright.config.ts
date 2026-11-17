// Playwright config for the demo-path browser suite (#121), run by demo verify
// against the stack demo up started. One worker, no retries: the tests walk
// one shared page in order, and a pass must be a real pass (AC13).
//
// No globalSetup on purpose: a globalSetup that throws can skip the teardown,
// and the teardown (demo reset) must always run.
import { defineConfig } from '@playwright/test';
import { HUB_URL, VIEWPORT } from './hub';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: HUB_URL,
    // Set here, not from devices['Desktop Chrome'] (1280x720).
    viewport: VIEWPORT,
    headless: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
