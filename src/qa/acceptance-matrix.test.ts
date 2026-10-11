import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_REQUIREMENT_IDS, validateAcceptanceMatrix } from "./acceptance-matrix";

const TEST_TITLE = "protects the mapped requirement";

interface RequirementFixture {
  id: string;
  ticket: string;
  criterion: string;
  evidence: Array<Record<string, string>>;
}

let rootDir: string;

function completeMatrix(): { version: number; requirements: RequirementFixture[] } {
  return {
    version: 1,
    requirements: REQUIRED_REQUIREMENT_IDS.map((id) => ({
      id,
      ticket: id.slice(0, 4).replace("BB0", "BB-0").replace("BB1", "BB-1"),
      criterion: `Criterion ${id}`,
      evidence: [{
        kind: "unit",
        environment: "local",
        file: "sample.test.ts",
        test: TEST_TITLE
      }]
    }))
  };
}

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "bb17-matrix-"));
  await writeFile(path.join(rootDir, "sample.test.ts"), `test(\"${TEST_TITLE}\", () => {});\n`, "utf8");
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("validateAcceptanceMatrix", () => {
  it("accepts a complete registry whose automated evidence resolves", async () => {
    await expect(validateAcceptanceMatrix(completeMatrix(), rootDir)).resolves.toEqual([]);
  });

  it("rejects missing or malformed registry data", async () => {
    await expect(validateAcceptanceMatrix(null, rootDir)).resolves.toContain("matrix.requirements must be an array");
  });

  it("rejects duplicate and missing stable requirement ids", async () => {
    const matrix = completeMatrix();
    const missing = matrix.requirements.pop()!;
    matrix.requirements.push({ ...matrix.requirements[0]! });

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain(`duplicate requirement id: ${matrix.requirements[0]!.id}`);
    expect(errors).toContain(`missing requirement id: ${missing.id}`);
  });

  it("rejects automated evidence whose file or test title is stale", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.evidence[0]!.file = "missing.test.ts";
    matrix.requirements[1]!.evidence[0]!.test = "renamed test title";

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain(`${matrix.requirements[0]!.id}: evidence file does not exist: missing.test.ts`);
    expect(errors).toContain(`${matrix.requirements[1]!.id}: test title not found in sample.test.ts: renamed test title`);
  });

  it("rejects manual evidence without both a reason and checklist anchor", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.evidence = [{
      kind: "manual",
      environment: "Mercado Pago sandbox",
      reason: "",
      checklist: ""
    }];

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain(`${matrix.requirements[0]!.id}: manual evidence requires a reason`);
    expect(errors).toContain(`${matrix.requirements[0]!.id}: manual evidence requires a checklist anchor`);
  });
});
