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

function markdownAnchor(heading: string): string {
  return heading
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/\s+/g, "-");
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
        const checklist = text(evidence?.checklist);
        if (!checklist) {
          errors.push(`${id}: manual evidence requires a checklist anchor`);
          continue;
        }
        const [file = "", anchor = ""] = checklist.split("#", 2);
        let source: string;
        try {
          source = await readFile(path.resolve(rootDir, file), "utf8");
        } catch {
          errors.push(`${id}: checklist file does not exist: ${file || "<missing>"}`);
          continue;
        }
        const anchors = source
          .split(/\r?\n/)
          .flatMap((line) => {
            const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
            return match ? [markdownAnchor(match[1]!)] : [];
          });
        if (!anchor || !anchors.includes(anchor)) {
          errors.push(`${id}: checklist anchor not found in ${file}: ${anchor || "<missing>"}`);
        }
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
