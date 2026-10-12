import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import defaultConfig from "../playwright.config";
import adminAuthConfig from "../playwright.admin-auth.config";
import packageJson from "../package.json";

const dedicatedConfigPath = path.resolve(process.cwd(), "playwright.admin-auth.config.ts");

describe("admin authentication Playwright isolation", () => {
  it("keeps the credential-bearing spec out of the default artifact-producing projects", () => {
    for (const project of defaultConfig.projects ?? []) {
      if (project.name === "mobile" || project.name === "desktop") {
        expect(Array.isArray(project.testIgnore)).toBe(true);
        expect((project.testIgnore as RegExp[]).some((pattern) => pattern.test("admin-auth.spec.ts"))).toBe(true);
      }
    }
  });

  it("provides a dedicated no-artifact command that loads local credentials", () => {
    expect(fs.existsSync(dedicatedConfigPath)).toBe(true);
    expect(packageJson.scripts["test:e2e:admin-auth"]).toContain("--env-file-if-exists=.env.local");
    expect(packageJson.scripts["test:e2e:admin-auth"]).toContain("playwright.admin-auth.config.ts");
    expect(adminAuthConfig.testMatch).toEqual(/admin-auth\.spec\.ts/);
    expect(adminAuthConfig.retries).toBe(0);
    expect(adminAuthConfig.reporter).toBe("line");
    expect(adminAuthConfig.outputDir).toBe("test-results/admin-auth");
    expect(adminAuthConfig.preserveOutput).toBe("never");
    expect(adminAuthConfig.use).toMatchObject({ trace: "off", screenshot: "off", video: "off" });
  });

  it("configures the public runner to fail on flaky retries and retain failure evidence", () => {
    expect(defaultConfig.retries).toBe(0);
    expect(defaultConfig.preserveOutput).toBe("failures-only");
    expect(defaultConfig.use).toMatchObject({
      screenshot: "only-on-failure",
      trace: "retain-on-failure"
    });
  });
});
