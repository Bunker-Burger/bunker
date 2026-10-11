import { defineConfig, devices } from "@playwright/test";

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  outputDir: "test-results/playwright",
  preserveOutput: "failures-only",
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "mobile",
      testIgnore: [/responsive\.spec\.ts/, /admin-auth\.spec\.ts/],
      use: { ...devices["Pixel 7"] }
    },
    {
      name: "desktop",
      testIgnore: [/responsive\.spec\.ts/, /admin-auth\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] }
    },
    // BB-02 responsive matrix: explicit widths, touch below desktop so the on-screen keyboard path is covered.
    ...[
      { width: 320, height: 568, touch: true },
      { width: 390, height: 844, touch: true },
      { width: 768, height: 1024, touch: true },
      { width: 1280, height: 800, touch: false }
    ].map(({ width, height, touch }) => ({
      name: `viewport-${width}`,
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width, height },
        isMobile: touch,
        hasTouch: touch,
        deviceScaleFactor: touch ? 2 : 1
      }
    }))
  ],
  webServer: {
    // E2E runs against the production build (`pnpm run build` first) so hydration matches what users get.
    command: `pnpm run start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
