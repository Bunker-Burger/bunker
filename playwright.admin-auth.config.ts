import { defineConfig, devices } from "@playwright/test";

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /admin-auth\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  outputDir: "test-results/admin-auth",
  preserveOutput: "failures-only",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{ name: "admin-auth", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm run start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
