import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * BB-04 boundary: UI code (routes and components) gets domain objects from server
 * repositories (`@/server/catalog`), never a Supabase client or a table name.
 */

const SRC = path.resolve(__dirname, "..");
const UI_ROOTS = ["app", "components"].map((dir) => path.join(SRC, dir));

const FORBIDDEN_IMPORTS = [/^@supabase\//, /^@\/server\/supabase(\/|$)/, /^@\/lib\/supabase(\/|$)/, /database\.types$/];
const TABLE_ACCESS = /\.(from|rpc)\(\s*["'`]/;

function uiFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return uiFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

export function boundaryViolations(file: string, source: string): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(/(?:import|export)[^'"`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1] ?? match[2] ?? "";
    if (FORBIDDEN_IMPORTS.some((pattern) => pattern.test(specifier))) violations.push(`${file} imports ${specifier}`);
  }
  if (TABLE_ACCESS.test(source)) violations.push(`${file} queries a table directly`);
  return violations;
}

describe("data access boundary", () => {
  it("detects forbidden imports and direct table access", () => {
    expect(boundaryViolations("a.tsx", 'import { createClient } from "@supabase/supabase-js";')).toHaveLength(1);
    expect(boundaryViolations("a.tsx", 'import { createSessionClient } from "@/server/supabase/clients";')).toHaveLength(1);
    expect(boundaryViolations("a.tsx", 'import type { Database } from "@/server/supabase/database.types";')).toHaveLength(1);
    expect(boundaryViolations("a.tsx", 'const m = await import("@/lib/supabase/browser-client");')).toHaveLength(1);
    expect(boundaryViolations("a.tsx", 'await client.from("products").select("*");')).toHaveLength(1);
    expect(boundaryViolations("a.tsx", 'import { getPublicCatalog } from "@/server/catalog";')).toEqual([]);
    expect(boundaryViolations("a.tsx", "const list = Array.from(items);")).toEqual([]);
  });

  it("holds for every route and component", () => {
    const violations = UI_ROOTS.flatMap(uiFiles).flatMap((file) =>
      boundaryViolations(path.relative(SRC, file), readFileSync(file, "utf8"))
    );
    expect(violations).toEqual([]);
  });
});
