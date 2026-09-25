import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests of the dev game (docs/E2E.md). The dev server must run
 * (npm start); each test starts and stops its own coop relay. One test at a
 * time: they share the relay port and the GPU. Headed: the photorealistic
 * tiles need a real GPU context. SLOWMO=300 slows every action to watch.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  globalSetup: './support/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  // A map loads in up to a few minutes; a coop test loads two
  timeout: 15 * 60_000,
  // A run never hangs for good
  globalTimeout: 90 * 60_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.GAME_URL ?? 'http://localhost:4200',
    headless: false,
    // A click on something covered fails in half a minute, not at the test's end
    actionTimeout: 30_000,
    viewport: { width: 1600, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
  },
});
