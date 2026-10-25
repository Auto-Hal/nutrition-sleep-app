import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  // Keep fixture HTML in the parent directory: Playwright clears outputDir.
  outputDir: "test-results/playwright",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    // This suite uses public auth shells and synthetic data, with no saved auth
    // state. Do not produce traces that could later capture real credentials.
    trace: "off",
    screenshot: "only-on-failure",
    navigationTimeout: 90_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
    { name: "webkit-ipad", use: { ...devices["iPad Mini"] } },
  ],
  webServer: [
    {
      command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Intentionally synthetic even on a workstation with a local .env.
        // These tests never require Supabase or Google Health credentials.
        SUPABASE_URL: "https://e2e.invalid",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_placeholder",
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/e2e_placeholder",
        APP_SESSION_ENCRYPTION_KEY: "e2e-only-placeholder-32-byte-value",
        APP_ALLOWED_USER_ID: "00000000-0000-4000-8000-000000000001",
        APP_LOGIN_RATE_LIMIT_KEY: "e2e-only-rate-limit-key-32-byte-value",
        APP_ORIGIN: "http://127.0.0.1:3000",
      },
    },
    {
      command: "node scripts/serve-sleep-preview.mjs",
      url: "http://127.0.0.1:4175/sleep-score-preview.html",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
