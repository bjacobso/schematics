import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 1,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  updateSnapshots: "missing",
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 150,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4318",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    env: {
      TZ: "UTC",
      E2E_NOW: "2026-02-25T12:00:00.000Z",
      E2E_ID_SEED: "e2e",
      VITE_SCHEMA_IDE_API_BASE_URL: "/__schema_ide_e2e__",
    },
  },
});
