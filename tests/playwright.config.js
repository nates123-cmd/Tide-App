// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Tide QA harness config.
 *
 * Serves the single-file PWA over a static HTTP server (no build step) and
 * drives it with Chromium. Tests call the app's REAL window globals through
 * page.evaluate — they never re-implement app logic.
 *
 * The app's index.html lives one directory up from tests/, so the static
 * server roots at "..". baseURL points at the served index.html.
 */
const PORT = 8214;

module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Block all external network so a test never hits Supabase / Claude / Oura.
    // (Set per-test if a test needs to allow specific hosts.)
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --directory ..`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
