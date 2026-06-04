import { defineConfig, devices } from "@playwright/test";

const e2eMode = process.env["SCHEMATICS_E2E_MODE"] ?? "all";
const playgroundPort = Number(
  process.env["SCHEMATICS_E2E_PLAYGROUND_PORT"] ?? (e2eMode === "hosted" ? 4338 : 4339),
);
const hostedApiPort = Number(process.env["SCHEMATICS_E2E_API_PORT"] ?? 4337);

const hostedServer = {
  command:
    "pnpm --dir ../.. --filter @schematics/artifacts --filter @schematics/core --filter @schematics/examples --filter @schematics/protocol --filter @schematics/server build && node tests/support/hosted-workspace-server.mjs",
  url: `http://127.0.0.1:${hostedApiPort}/__schematics_e2e__/health`,
  reuseExistingServer: !process.env["CI"],
  timeout: 240_000,
  env: {
    PORT: String(hostedApiPort),
    TZ: "UTC",
    E2E_NOW: "2026-02-25T12:00:00.000Z",
    E2E_ID_SEED: "e2e",
  },
};

const playgroundServer = {
  command: `pnpm exec vite --host 127.0.0.1 --port ${playgroundPort}`,
  url: `http://127.0.0.1:${playgroundPort}`,
  reuseExistingServer: !process.env["CI"],
  timeout: 180_000,
  env: {
    TZ: "UTC",
    E2E_NOW: "2026-02-25T12:00:00.000Z",
    E2E_ID_SEED: "e2e",
    SCHEMATICS_E2E_API_PORT: String(hostedApiPort),
    VITE_SCHEMATICS_API_BASE_URL: "/__schematics_e2e__",
    VITE_E2E_NOW: "2026-02-25T12:00:00.000Z",
  },
};

const hostedPlaygroundServer = {
  command: `pnpm exec vite --host 127.0.0.1 --port ${playgroundPort}`,
  url: `http://127.0.0.1:${playgroundPort}`,
  reuseExistingServer: !process.env["CI"],
  timeout: 180_000,
  env: {
    TZ: "UTC",
    E2E_NOW: "2026-02-25T12:00:00.000Z",
    E2E_ID_SEED: "e2e",
    SCHEMATICS_E2E_API_PORT: String(hostedApiPort),
    VITE_SCHEMATICS_API_BASE_URL: "/__schematics_e2e__",
    VITE_E2E_NOW: "2026-02-25T12:00:00.000Z",
  },
};

const localFilesystemServer = {
  command:
    "pnpm --dir ../.. run build && node ../../examples/onboarded/dist/cli.js web --dir ../../examples/onboarded/projects/onboarded-account-yaml/files --port 4319 --static-dir dist",
  url: "http://127.0.0.1:4319",
  reuseExistingServer: !process.env["CI"],
  timeout: 240_000,
  env: {
    TZ: "UTC",
    E2E_NOW: "2026-02-25T12:00:00.000Z",
    E2E_ID_SEED: "e2e",
  },
};

const localGitServer = {
  command: "pnpm --dir ../.. run build && node tests/support/onboarded-git-server.mjs",
  url: "http://127.0.0.1:4320",
  reuseExistingServer: !process.env["CI"],
  timeout: 240_000,
  env: {
    TZ: "UTC",
    E2E_NOW: "2026-02-25T12:00:00.000Z",
    E2E_ID_SEED: "e2e",
  },
};

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
    baseURL: `http://127.0.0.1:${playgroundPort}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: webServersForMode(e2eMode),
});

function webServersForMode(mode: string) {
  switch (mode) {
    case "hosted":
      return [hostedServer, hostedPlaygroundServer];
    case "playground":
      return playgroundServer;
    case "local-filesystem":
      return localFilesystemServer;
    case "local-git":
      return localGitServer;
    case "all":
      return [hostedServer, playgroundServer, localFilesystemServer, localGitServer];
    default:
      throw new Error(
        `Unknown SCHEMATICS_E2E_MODE=${JSON.stringify(
          mode,
        )}. Expected all, hosted, playground, local-filesystem, or local-git.`,
      );
  }
}
