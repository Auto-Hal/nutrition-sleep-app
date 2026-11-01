import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  maxFailures: 1,
  retries: 0,
  outputDir: "test-results/nutrition-browser",
  reporter: [
    ["list"],
    ["html", { outputFolder: "nutrition-playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3001",
    timezoneId: "Asia/Tokyo",
    trace: "off",
    screenshot: "only-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
    { name: "webkit-ipad", use: { ...devices["iPad Mini"] } },
  ],
});
