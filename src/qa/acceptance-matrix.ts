import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED_TICKETS = [
  "BB-07",
  "BB-08",
  "BB-09",
  "BB-10",
  "BB-11",
  "BB-12",
  "BB-13",
  "BB-14",
  "BB-15",
  "BB-16",
  "BB-17"
] as const;

export const REQUIRED_REQUIREMENT_IDS = REQUIRED_TICKETS.flatMap((ticket) =>
  [1, 2, 3, 4].map((number) => `${ticket.replace("-", "")}-AC${number}`)
);

const AUTOMATED_KINDS = new Set(["unit", "integration", "database", "e2e"]);

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function validateAcceptanceMatrix(matrix: unknown, rootDir: string): Promise<string[]> {
  const document = object(matrix);
  if (!document || !Array.isArray(document.requirements)) {
    return ["matrix.requirements must be an array"];
  }

  const errors: string[] = [];
  const ids = new Set<string>();

  for (const rawRequirement of document.requirements) {
    const requirement = object(rawRequirement);
    const id = text(requirement?.id) || "<missing-id>";
    if (ids.has(id)) errors.push(`duplicate requirement id: ${id}`);
    ids.add(id);

    if (!requirement || !Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
      errors.push(`${id}: evidence must be a non-empty array`);
      continue;
    }

    for (const rawEvidence of requirement.evidence) {
      const evidence = object(rawEvidence);
      const kind = text(evidence?.kind);
      if (kind === "manual") {
        if (!text(evidence?.reason)) errors.push(`${id}: manual evidence requires a reason`);
        if (!text(evidence?.checklist)) errors.push(`${id}: manual evidence requires a checklist anchor`);
        continue;
      }

      if (!AUTOMATED_KINDS.has(kind)) {
        errors.push(`${id}: unsupported evidence kind: ${kind || "<missing>"}`);
        continue;
      }

      const file = text(evidence?.file);
      const testTitle = text(evidence?.test);
      let source: string;
      try {
        source = await readFile(path.resolve(rootDir, file), "utf8");
      } catch {
        errors.push(`${id}: evidence file does not exist: ${file || "<missing>"}`);
        continue;
      }
      if (!testTitle || !source.includes(testTitle)) {
        errors.push(`${id}: test title not found in ${file}: ${testTitle || "<missing>"}`);
      }
    }
  }

  for (const id of REQUIRED_REQUIREMENT_IDS) {
    if (!ids.has(id)) errors.push(`missing requirement id: ${id}`);
  }

  return errors;
}
