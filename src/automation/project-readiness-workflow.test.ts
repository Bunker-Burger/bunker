import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/project-readiness.yml"),
  "utf8",
);

describe("project readiness workflow trust boundary", () => {
  it("never runs the secret-bearing workflow for pull requests", () => {
    expect(workflow).toContain("PROJECT_SYNC_TOKEN");
    expect(workflow).not.toMatch(/^\s*pull_request\s*:/m);
  });

  it("allows manual synchronization only from the trusted main ref", () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch\s*:/m);
    expect(workflow).toContain(
      "github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'",
    );
  });
});
