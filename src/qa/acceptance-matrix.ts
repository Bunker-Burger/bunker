import * as ts from "typescript";
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
    .replace(/[^\p{Letter}\p{Number} _-]/gu, "")
    .replace(/\s+/g, "-");
}
function expectedTicketForId(id: string): string {
  const match = /^([A-Z]{2})(\d{2})-AC\d+$/.exec(id);
  return match ? `${match[1]}-${match[2]}` : "";
}

function stripSqlComments(source: string): string {
  let result = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    if (source[i] === "'") {
      result += "'";
      i++;
      while (i < n) {
        if (source[i] === "'" && source[i + 1] === "'") {
          result += "''";
          i += 2;
        } else if (source[i] === "'") {
          result += "'";
          i++;
          break;
        } else {
          result += source[i];
          i++;
        }
      }
    } else if (source[i] === "-" && source[i + 1] === "-") {
      i += 2;
      while (i < n && source[i] !== "\n" && source[i] !== "\r") {
        i++;
      }
    } else if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i += 2;
    } else {
      result += source[i];
      i++;
    }
  }
  return result;
}

const JS_TEST_ROOTS = new Set(["it", "test"]);

/** Only executable test declarations count: never parse text inside strings or comments as code. */
function isTestCall(expression: ts.LeftHandSideExpression): boolean {
  if (ts.isIdentifier(expression)) return JS_TEST_ROOTS.has(expression.text);

  // Vitest / Playwright: it.each([...])("title", fn), test.skipIf(cond)("title", fn).
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const { expression: root, name } = expression.expression;
    return ts.isIdentifier(root) && JS_TEST_ROOTS.has(root.text)
      && (name.text === "each" || name.text === "skipIf" || name.text === "runIf");
  }

  // Vitest tagged tables: it.each`...\`("title", fn).
  if (ts.isTaggedTemplateExpression(expression) && ts.isPropertyAccessExpression(expression.tag)) {
    const { expression: root, name } = expression.tag;
    return name.text === "each" && ts.isIdentifier(root) && JS_TEST_ROOTS.has(root.text);
  }

  return false;
}

/** Registry titles may be distinctive static fragments of an actual parameterized test. */
function hasTitleFragment(title: ts.Expression, fragment: string): boolean {
  if (ts.isStringLiteralLike(title)) return title.text.includes(fragment);
  if (ts.isTemplateExpression(title)) {
    return [title.head.text, ...title.templateSpans.map((span) => span.literal.text)]
      .some((part) => part.includes(fragment));
  }
  return false;
}

function checkJsTestDeclaration(source: string, testTitle: string, file: string): boolean {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && isTestCall(node.expression)) {
      const [title, implementation] = node.arguments;
      if (title && hasTitleFragment(title, testTitle)
        && implementation && (ts.isArrowFunction(implementation) || ts.isFunctionExpression(implementation))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return found;
}

const PGTAP_ASSERTIONS = new Set([
  "ok",
  "is",
  "isnt",
  "matches",
  "throws_ok",
  "lives_ok",
  "cmp_ok",
  "pass",
  "fail"
]);

function checkPgTapAssertion(cleanSource: string, testTitle: string): boolean {
  let searchPos = 0;
  while (true) {
    const idx = cleanSource.indexOf(testTitle, searchPos);
    if (idx === -1) return false;
    searchPos = idx + 1;

    let depth = 0;
    let funcName = "";
    let i = idx - 1;
    while (i >= 0) {
      if (cleanSource[i] === ")") {
        depth++;
      } else if (cleanSource[i] === "(") {
        if (depth === 0) {
          let j = i - 1;
          while (j >= 0 && /\s/.test(cleanSource[j]!)) {
            j--;
          }
          const nameEnd = j;
          while (j >= 0 && /[a-zA-Z0-9_]/.test(cleanSource[j]!)) {
            j--;
          }
          funcName = cleanSource.slice(j + 1, nameEnd + 1).toLowerCase();
          break;
        } else {
          depth--;
        }
      } else if (cleanSource[i] === ";") {
        break;
      }
      i--;
    }

    if (PGTAP_ASSERTIONS.has(funcName)) {
      return true;
    }
  }
}

function isValidTestEvidence(source: string, testTitle: string, file: string): boolean {
  if (!testTitle) return false;
  if (file.endsWith(".sql")) {
    const clean = stripSqlComments(source);
    return checkPgTapAssertion(clean, testTitle);
  }
  return checkJsTestDeclaration(source, testTitle, file);
}

export async function validateAcceptanceMatrix(matrix: unknown, rootDir: string): Promise<string[]> {
  const document = object(matrix);
  if (!document || !Array.isArray(document.requirements)) {
    return ["matrix.requirements must be an array"];
  }

  const errors: string[] = [];
  if (document.version !== 1) {
    errors.push("matrix.version must be 1");
  }

  const ids = new Set<string>();
  const requiredIdSet = new Set<string>(REQUIRED_REQUIREMENT_IDS);

  for (const rawRequirement of document.requirements) {
    const requirement = object(rawRequirement);
    const id = text(requirement?.id) || "<missing-id>";
    if (ids.has(id)) errors.push(`duplicate requirement id: ${id}`);
    ids.add(id);

    if (!requiredIdSet.has(id)) {
      errors.push(`extra requirement id: ${id}`);
    }

    const ticket = text(requirement?.ticket);
    const expectedTicket = expectedTicketForId(id);
    if (!ticket || ticket !== expectedTicket) {
      errors.push(`${id}: ticket does not match id: ${ticket || "<missing>"}`);
    }

    const criterion = text(requirement?.criterion);
    if (!criterion) {
      errors.push(`${id}: criterion must be a non-empty string`);
    }

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
      if (!testTitle || !isValidTestEvidence(source, testTitle, file)) {
        errors.push(`${id}: test title not found in ${file}: ${testTitle || "<missing>"}`);
      }
    }
  }

  for (const id of REQUIRED_REQUIREMENT_IDS) {
    if (!ids.has(id)) errors.push(`missing requirement id: ${id}`);
  }

  return errors;
}
