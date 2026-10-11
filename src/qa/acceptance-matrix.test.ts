import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import repositoryMatrix from "../../docs/qa/bb17-acceptance-matrix.json";
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

  it("rejects manual evidence whose checklist file or heading is stale", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.evidence = [{
      kind: "manual",
      environment: "Mercado Pago sandbox",
      reason: "A third-party sandbox needs a maintained account.",
      checklist: "docs/qa/manual.md#mercado-pago-sandbox"
    }];

    const missingFile = await validateAcceptanceMatrix(matrix, rootDir);
    expect(missingFile).toContain(`${matrix.requirements[0]!.id}: checklist file does not exist: docs/qa/manual.md`);

    await writeFile(path.join(rootDir, "manual.md"), "# Another heading\n", "utf8");
    matrix.requirements[0]!.evidence[0]!.checklist = "manual.md#mercado-pago-sandbox";
    const missingAnchor = await validateAcceptanceMatrix(matrix, rootDir);
    expect(missingAnchor).toContain(`${matrix.requirements[0]!.id}: checklist anchor not found in manual.md: mercado-pago-sandbox`);
  });

  it("uses GitHub-compatible anchors for headings with accents", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.evidence = [{
      kind: "manual",
      environment: "local",
      reason: "The check requires assistive technology.",
      checklist: "manual.md#tecnología-asistiva"
    }];
    await writeFile(path.join(rootDir, "manual.md"), "## Tecnología asistiva\n", "utf8");

    await expect(validateAcceptanceMatrix(matrix, rootDir)).resolves.toEqual([]);

    matrix.requirements[0]!.evidence[0]!.checklist = "manual.md#tecnologia-asistiva";
    await expect(validateAcceptanceMatrix(matrix, rootDir)).resolves.toContain(
      `${matrix.requirements[0]!.id}: checklist anchor not found in manual.md: tecnologia-asistiva`
    );
  });

  it("keeps every BB-07 through BB-17 requirement mapped to resolvable evidence", async () => {
    const tickets = new Set(repositoryMatrix.requirements.map(({ ticket }) => ticket));
    expect(tickets).toEqual(new Set([
      "BB-07", "BB-08", "BB-09", "BB-10", "BB-11", "BB-12",
      "BB-13", "BB-14", "BB-15", "BB-16", "BB-17"
    ]));
    await expect(validateAcceptanceMatrix(repositoryMatrix, process.cwd())).resolves.toEqual([]);
  });
});
