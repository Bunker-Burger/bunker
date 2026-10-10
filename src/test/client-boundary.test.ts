import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * React Server Components: a server module that imports a *value* from a "use client" module gets
 * a client reference, not the value, so `SECTIONS.map(...)` throws at request time (BB-13 found
 * this only against the real server; jsdom tests render both sides as plain modules). Components
 * are fine to import; constants are not.
 */

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const isClient = (source: string) => /^\s*["']use client["'];?/.test(source);

/** `export const NAME = …` that is not a component (components start with a capital and render). */
export function exportedConstants(source: string): string[] {
  return [...source.matchAll(/^export const ([A-Z][A-Z0-9_]+)\b/gm)].map((match) => match[1]!);
}

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function boundaryViolations(files: Array<{ file: string; source: string }>, resolve = resolveImport): string[] {
  const clientConstants = new Map(files.filter(({ source }) => isClient(source)).map(({ file, source }) => [file, new Set(exportedConstants(source))]));
  const violations: string[] = [];
  for (const { file, source } of files) {
    if (isClient(source)) continue;
    for (const match of source.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      const target = resolve(file, match[2]!);
      const constants = target ? clientConstants.get(target) : undefined;
      if (!constants) continue;
      for (const name of match[1]!.split(",").map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!)) {
        if (constants.has(name)) violations.push(`${path.relative(SRC, file)} imports ${name} from a "use client" module`);
      }
    }
  }
  return violations;
}

describe("server/client module boundary", () => {
  it("flags a server module importing a constant from a client module, but not a component", () => {
    const files = [
      { file: "/x/nav.tsx", source: '"use client";\nexport const SECTIONS = [1];\nexport function Nav() { return null; }' },
      { file: "/x/page.tsx", source: 'import { Nav, SECTIONS } from "./nav";' },
      { file: "/x/other.tsx", source: 'import { Nav } from "./nav";' }
    ];
    const resolve = (_from: string, specifier: string) => (specifier === "./nav" ? "/x/nav.tsx" : null);
    expect(boundaryViolations(files, resolve)).toEqual([`${path.relative(SRC, "/x/page.tsx")} imports SECTIONS from a "use client" module`]);
  });

  it("holds for the whole app", () => {
    const files = sourceFiles(SRC).map((file) => ({ file, source: readFileSync(file, "utf8") }));
    expect(boundaryViolations(files)).toEqual([]);
  });
});
