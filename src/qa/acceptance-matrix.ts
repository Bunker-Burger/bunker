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

function isStaticallyFalsy(expr: ts.Expression): boolean {
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isNumericLiteral(expr) && expr.text === "0") return true;
  if (ts.isStringLiteral(expr) && expr.text === "") return true;
  if (expr.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(expr) && expr.text === "undefined") return true;
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    return isStaticallyTruthy(expr.operand);
  }
  return false;
}

function isStaticallyTruthy(expr: ts.Expression): boolean {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(expr) && expr.text !== "0") return true;
  if (ts.isStringLiteral(expr) && expr.text !== "") return true;
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    return isStaticallyFalsy(expr.operand);
  }
  return false;
}

function isStaticallyEmptyIterable(expr: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) return true;
  if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) return true;
  if (ts.isStringLiteral(expr) && expr.text === "") return true;
  return false;
}

function isStaticallyEmptyTaggedTable(expr: ts.TaggedTemplateExpression): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(expr.template)) return true;
  if (ts.isTemplateExpression(expr.template) && expr.template.templateSpans.length === 0) return true;
  return false;
}

function getStaticNumericValue(expr: ts.Expression): number | null {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) {
    return -Number(expr.operand.text);
  }
  return null;
}

function isStaticallyEmptyFor(node: ts.ForStatement): boolean {
  if (node.condition && isStaticallyFalsy(node.condition)) return true;
  if (node.initializer && ts.isVariableDeclarationList(node.initializer) && node.initializer.declarations.length === 1) {
    const decl = node.initializer.declarations[0]!;
    if (ts.isIdentifier(decl.name) && decl.initializer) {
      const initVal = getStaticNumericValue(decl.initializer);
      if (initVal !== null && node.condition && ts.isBinaryExpression(node.condition)) {
        if (ts.isIdentifier(node.condition.left) && node.condition.left.text === decl.name.text) {
          const limitVal = getStaticNumericValue(node.condition.right);
          if (limitVal !== null) {
            const op = node.condition.operatorToken.kind;
            if (op === ts.SyntaxKind.LessThanToken && !(initVal < limitVal)) return true;
            if (op === ts.SyntaxKind.LessThanEqualsToken && !(initVal <= limitVal)) return true;
            if (op === ts.SyntaxKind.GreaterThanToken && !(initVal > limitVal)) return true;
            if (op === ts.SyntaxKind.GreaterThanEqualsToken && !(initVal >= limitVal)) return true;
            if ((op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) && !(initVal === limitVal)) return true;
          }
        }
      }
    }
  }
  return false;
}

const JS_TEST_ROOTS = new Set(["it", "test"]);

/** Only executable test declarations count: never parse text inside strings or comments as code. */
function isTestCall(expression: ts.LeftHandSideExpression): boolean {
  if (ts.isIdentifier(expression)) return JS_TEST_ROOTS.has(expression.text);

  // Vitest / Playwright: it.each([...])("title", fn), test.skipIf(cond)("title", fn), test.runIf(cond)("title", fn).
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const { expression: root, name } = expression.expression;
    if (ts.isIdentifier(root) && JS_TEST_ROOTS.has(root.text)) {
      if (name.text === "each") {
        const table = expression.arguments[0];
        return Boolean(table && !isStaticallyEmptyIterable(table));
      }
      if (name.text === "skipIf") {
        const cond = expression.arguments[0];
        return !cond || !isStaticallyTruthy(cond);
      }
      if (name.text === "runIf") {
        const cond = expression.arguments[0];
        return !cond || !isStaticallyFalsy(cond);
      }
    }
  }

  // Vitest tagged tables: it.each`...\`("title", fn).
  if (ts.isTaggedTemplateExpression(expression) && ts.isPropertyAccessExpression(expression.tag)) {
    const { expression: root, name } = expression.tag;
    if (name.text === "each" && ts.isIdentifier(root) && JS_TEST_ROOTS.has(root.text)) {
      return !isStaticallyEmptyTaggedTable(expression);
    }
    return false;
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

const SKIPPED_SUITE_MODIFIERS = new Set(["skip", "todo", "fixme"]);

function getPropertyChain(expr: ts.Expression): string[] | null {
  const parts: string[] = [];
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) {
    parts.unshift(current.text);
    return parts;
  }
  return null;
}

function isDescribeChain(chain: string[]): boolean {
  return chain[0] === "describe" || (chain[0] === "test" && chain[1] === "describe");
}

function getDescribeKind(expr: ts.LeftHandSideExpression): "active" | "skipped" | null {
  if (ts.isIdentifier(expr)) {
    return expr.text === "describe" ? "active" : null;
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const chain = getPropertyChain(expr);
    if (!chain || !isDescribeChain(chain)) return null;
    return chain.some((part) => SKIPPED_SUITE_MODIFIERS.has(part)) ? "skipped" : "active";
  }

  if (ts.isCallExpression(expr)) {
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const chain = getPropertyChain(expr.expression);
      if (!chain || !isDescribeChain(chain)) return null;
      if (chain.some((part) => SKIPPED_SUITE_MODIFIERS.has(part))) return "skipped";
      const name = expr.expression.name.text;
      if (name === "skipIf" && expr.arguments[0] && isStaticallyTruthy(expr.arguments[0])) {
        return "skipped";
      }
      if (name === "runIf" && expr.arguments[0] && isStaticallyFalsy(expr.arguments[0])) {
        return "skipped";
      }
      if (name === "each") {
        const table = expr.arguments[0];
        if (!table || isStaticallyEmptyIterable(table)) {
          return "skipped";
        }
      }
      return "active";
    }
  }

  if (ts.isTaggedTemplateExpression(expr)) {
    if (ts.isPropertyAccessExpression(expr.tag)) {
      const chain = getPropertyChain(expr.tag);
      if (chain && isDescribeChain(chain)) {
        if (chain.some((part) => SKIPPED_SUITE_MODIFIERS.has(part))) return "skipped";
        if (chain.includes("each") && isStaticallyEmptyTaggedTable(expr)) {
          return "skipped";
        }
        return "active";
      }
    }
  }

  return null;
}

function getDescribeCallback(call: ts.CallExpression): ts.ArrowFunction | ts.FunctionExpression | null {
  for (const arg of call.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      return arg;
    }
  }
  return null;
}

function checkJsTestDeclaration(source: string, testTitle: string, file: string): boolean {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found = false;

  function visitActiveNode(node: ts.Node): void {
    if (found) return;

    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      for (const statement of node.statements) {
        visitActiveNode(statement);
        if (found) return;
      }
      return;
    }

    if (ts.isExpressionStatement(node)) {
      visitActiveNode(node.expression);
      return;
    }

    if (ts.isLabeledStatement(node)) {
      visitActiveNode(node.statement);
      return;
    }

    if (ts.isTryStatement(node)) {
      visitActiveNode(node.tryBlock);
      if (node.finallyBlock) visitActiveNode(node.finallyBlock);
      return;
    }

    if (ts.isForStatement(node)) {
      if (!isStaticallyEmptyFor(node)) {
        visitActiveNode(node.statement);
      }
      return;
    }

    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      if (!isStaticallyEmptyIterable(node.expression)) {
        visitActiveNode(node.statement);
      }
      return;
    }

    if (ts.isDoStatement(node)) {
      visitActiveNode(node.statement);
      return;
    }

    if (ts.isWhileStatement(node)) {
      if (!isStaticallyFalsy(node.expression)) {
        visitActiveNode(node.statement);
      }
      return;
    }

    if (ts.isIfStatement(node)) {
      if (!isStaticallyFalsy(node.expression)) {
        visitActiveNode(node.thenStatement);
      }
      if (!isStaticallyTruthy(node.expression) && node.elseStatement) {
        visitActiveNode(node.elseStatement);
      }
      return;
    }

    if (ts.isCallExpression(node)) {
      if (isTestCall(node.expression)) {
        const [title, implementation] = node.arguments;
        if (title && hasTitleFragment(title, testTitle)
          && implementation && (ts.isArrowFunction(implementation) || ts.isFunctionExpression(implementation))) {
          found = true;
          return;
        }
        // Never traverse the test body (rejects nested tests inside test callbacks)
        return;
      }

      const describeKind = getDescribeKind(node.expression);
      if (describeKind === "active") {
        const callback = getDescribeCallback(node);
        if (callback) {
          visitActiveNode(callback.body);
        }
        return;
      }
      if (describeKind === "skipped") {
        return;
      }

      return;
    }
  }

  visitActiveNode(parsed);
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

function parsePgTapCallArguments(source: string, startPos: number): { endPos: number; argumentStrings: string[] } {
  let i = startPos;
  const n = source.length;
  let depth = 1;
  const argumentStrings: string[] = [];

  while (i < n && depth > 0) {
    if (/\s/.test(source[i]!)) {
      i++;
      continue;
    }

    // Single-line comment inside call args
    if (source[i] === "-" && source[i + 1] === "-") {
      i += 2;
      while (i < n && source[i] !== "\n" && source[i] !== "\r") {
        i++;
      }
      continue;
    }

    // Multi-line comment inside call args
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i = Math.min(n, i + 2);
      continue;
    }

    // Dollar-quoted string argument: $<tag>$...$<tag>$
    if (source[i] === "$") {
      const match = /^\$([a-zA-Z0-9_]*)\$/.exec(source.slice(i));
      if (match) {
        const tag = match[0];
        const contentStart = i + tag.length;
        const endTagIdx = source.indexOf(tag, contentStart);
        if (endTagIdx === -1) {
          break;
        }
        argumentStrings.push(source.slice(contentStart, endTagIdx));
        i = endTagIdx + tag.length;
        continue;
      }
    }

    // Single-quoted string argument: '...' (unescaping '')
    if (source[i] === "'") {
      i++;
      let strVal = "";
      while (i < n) {
        if (source[i] === "'" && source[i + 1] === "'") {
          strVal += "'";
          i += 2;
        } else if (source[i] === "'") {
          i++;
          break;
        } else {
          strVal += source[i];
          i++;
        }
      }
      argumentStrings.push(strVal);
      continue;
    }

    // Nested parentheses
    if (source[i] === "(") {
      depth++;
      i++;
      continue;
    }
    if (source[i] === ")") {
      depth--;
      i++;
      if (depth === 0) {
        break;
      }
      continue;
    }

    i++;
  }

  return { endPos: i, argumentStrings };
}

function checkPgTapAssertion(source: string, testTitle: string): boolean {
  let i = 0;
  const n = source.length;

  while (i < n) {
    if (/\s/.test(source[i]!)) {
      i++;
      continue;
    }

    // Single-line comment: -- ...
    if (source[i] === "-" && source[i + 1] === "-") {
      i += 2;
      while (i < n && source[i] !== "\n" && source[i] !== "\r") {
        i++;
      }
      continue;
    }

    // Multi-line comment: /* ... */
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i = Math.min(n, i + 2);
      continue;
    }

    // Dollar-quoted string literal: $<tag>$...$<tag>$ (skip the entire literal)
    if (source[i] === "$") {
      const match = /^\$([a-zA-Z0-9_]*)\$/.exec(source.slice(i));
      if (match) {
        const tag = match[0];
        const endTagIdx = source.indexOf(tag, i + tag.length);
        if (endTagIdx === -1) {
          break;
        }
        i = endTagIdx + tag.length;
        continue;
      }
    }

    // Standard single-quoted string literal: '...' (skip the entire literal)
    if (source[i] === "'") {
      i++;
      while (i < n) {
        if (source[i] === "'" && source[i + 1] === "'") {
          i += 2;
        } else if (source[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }

    // Double-quoted identifier: "..."
    if (source[i] === '"') {
      i++;
      while (i < n && source[i] !== '"') {
        i++;
      }
      if (i < n) i++;
      continue;
    }

    // Unquoted identifier: [a-zA-Z_][a-zA-Z0-9_.]*
    if (/[a-zA-Z_]/.test(source[i]!)) {
      const start = i;
      while (i < n && /[a-zA-Z0-9_.]/.test(source[i]!)) {
        i++;
      }
      const rawIdent = source.slice(start, i);
      const parts = rawIdent.split(".");
      const funcName = (parts[parts.length - 1] ?? "").toLowerCase();

      let j = i;
      while (j < n && /\s/.test(source[j]!)) {
        j++;
      }
      if (j < n && source[j] === "(") {
        if (PGTAP_ASSERTIONS.has(funcName)) {
          const { endPos, argumentStrings } = parsePgTapCallArguments(source, j + 1);
          for (const argStr of argumentStrings) {
            if (argStr.includes(testTitle)) {
              return true;
            }
          }
          i = endPos;
          continue;
        }
      }
      continue;
    }

    i++;
  }

  return false;
}

function isValidTestEvidence(source: string, testTitle: string, file: string): boolean {
  if (!testTitle) return false;
  if (file.endsWith(".sql")) {
    return checkPgTapAssertion(source, testTitle);
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
