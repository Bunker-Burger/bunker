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

  it("rejects automated evidence where the test title only appears in a comment", async () => {
    await writeFile(path.join(rootDir, "sample.test.ts"), `// test("${TEST_TITLE}", () => {});\n/* ${TEST_TITLE} */\n`, "utf8");

    const errors = await validateAcceptanceMatrix(completeMatrix(), rootDir);

    expect(errors).toContain(`BB07-AC1: test title not found in sample.test.ts: ${TEST_TITLE}`);
  });

  it("rejects automated evidence where the test title only appears in an arbitrary string", async () => {
    await writeFile(path.join(rootDir, "sample.test.ts"), `const message = "${TEST_TITLE}";\nconsole.log(message);\n`, "utf8");

    const errors = await validateAcceptanceMatrix(completeMatrix(), rootDir);

    expect(errors).toContain(`BB07-AC1: test title not found in sample.test.ts: ${TEST_TITLE}`);
  });

  it("rejects automated evidence where a test declaration is nested inside a string literal", async () => {
    await writeFile(path.join(rootDir, "sample.test.ts"), `const fake = 'test("${TEST_TITLE}", () => {});';\n`, "utf8");

    const errors = await validateAcceptanceMatrix(completeMatrix(), rootDir);

    expect(errors).toContain(`BB07-AC1: test title not found in sample.test.ts: ${TEST_TITLE}`);
  });

  it("rejects automated evidence where a test declaration is nested inside a template literal", async () => {
    await writeFile(path.join(rootDir, "sample.test.ts"), `const fake = \`test("${TEST_TITLE}", () => {});\`;\n`, "utf8");

    const errors = await validateAcceptanceMatrix(completeMatrix(), rootDir);

    expect(errors).toContain(`BB07-AC1: test title not found in sample.test.ts: ${TEST_TITLE}`);
  });

  it("rejects automated evidence in SQL where the assertion only appears in a comment", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.evidence[0]!.file = "sample.sql";
    await writeFile(path.join(rootDir, "sample.sql"), `-- select ok(1, '${TEST_TITLE}');\nselect 1;\n`, "utf8");

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain(`BB07-AC1: test title not found in sample.sql: ${TEST_TITLE}`);
  });

  it("rejects incorrect matrix version", async () => {
    const matrix = { ...completeMatrix(), version: 2 };

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain("matrix.version must be 1");
  });

  it("rejects mismatched requirement tickets (ticket cruzado)", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.ticket = "BB-08"; // ID is BB07-AC1

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain(`${matrix.requirements[0]!.id}: ticket does not match id: BB-08`);
  });

  it("rejects empty requirement criterion", async () => {
    const matrix = completeMatrix();
    matrix.requirements[0]!.criterion = "   ";

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain(`${matrix.requirements[0]!.id}: criterion must be a non-empty string`);
  });

  it("rejects extra requirement ids", async () => {
    const matrix = completeMatrix();
    matrix.requirements.push({
      id: "BB07-AC5",
      ticket: "BB-07",
      criterion: "Extra requirement criterion",
      evidence: [{
        kind: "unit",
        environment: "local",
        file: "sample.test.ts",
        test: TEST_TITLE
      }]
    });

    const errors = await validateAcceptanceMatrix(matrix, rootDir);

    expect(errors).toContain("extra requirement id: BB07-AC5");
  });

  it("accepts valid test declarations across Vitest it, test, it.each, test.each, and pgTAP", async () => {
    const matrix = completeMatrix();
    await writeFile(path.join(rootDir, "sample.test.ts"), `
      test("${TEST_TITLE}", () => {});
      it("BB07-AC1 test", () => {});
      test("BB07-AC2 test", async () => {});
      it.each([["a"], ["b"]])("BB07-AC3 %s test", () => {});
      test.each([1, 2])("BB07-AC4 %i test", () => {});
    `, "utf8");
    matrix.requirements[0]!.evidence[0]!.test = "BB07-AC1 test";
    matrix.requirements[1]!.evidence[0]!.test = "BB07-AC2 test";
    matrix.requirements[2]!.evidence[0]!.test = "BB07-AC3 %s test";
    matrix.requirements[3]!.evidence[0]!.test = "BB07-AC4 %i test";

    await writeFile(path.join(rootDir, "sample.sql"), `
      select ok(1 = 1, 'BB08-AC1 sql test');
      select is(2, 2, 'BB08-AC2 sql test');
    `, "utf8");
    matrix.requirements[4]!.evidence[0]!.file = "sample.sql";
    matrix.requirements[4]!.evidence[0]!.test = "BB08-AC1 sql test";
    matrix.requirements[5]!.evidence[0]!.file = "sample.sql";
    matrix.requirements[5]!.evidence[0]!.test = "BB08-AC2 sql test";

    const errors = await validateAcceptanceMatrix(matrix, rootDir);
    expect(errors).toEqual([]);
  });

  it("keeps every BB-07 through BB-17 requirement mapped to resolvable evidence", async () => {
    expect(repositoryMatrix.version).toBe(1);
    expect(repositoryMatrix.requirements).toHaveLength(44);
    const tickets = new Set(repositoryMatrix.requirements.map(({ ticket }) => ticket));
    expect(tickets).toEqual(new Set([
      "BB-07", "BB-08", "BB-09", "BB-10", "BB-11", "BB-12",
      "BB-13", "BB-14", "BB-15", "BB-16", "BB-17"
    ]));
    await expect(validateAcceptanceMatrix(repositoryMatrix, process.cwd())).resolves.toEqual([]);
  });
});
