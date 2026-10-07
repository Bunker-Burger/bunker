import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/project-readiness.yml"),
  "utf8",
);

describe("project readiness workflow trust boundary", () => {
  it("never exposes the secret-bearing workflow to branch-controlled triggers", () => {
    expect(workflow).toContain("PROJECT_SYNC_TOKEN");
    expect(workflow).not.toMatch(/^\s*pull_request\s*:/m);
    expect(workflow).not.toMatch(/^\s*pull_request_target\s*:/m);
    expect(workflow).not.toMatch(/^\s*workflow_dispatch\s*:/m);
  });

  it("runs push reconciliation only for main", () => {
    expect(workflow).toMatch(
      /^\s*push\s*:\s*\r?\n\s*branches\s*:\s*\[main\]\s*$/m,
    );
  });
});
