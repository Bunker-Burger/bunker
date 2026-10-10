import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
// Plain Node ESM so CI can run it without installing app code.
// @ts-expect-error The JavaScript module carries its own runtime contract and is tested below.
import { classify } from "../../scripts/ci/cloud-evidence-scope.mjs";

/*
 * The scope classifier of the cloud evidence protocol (docs/runbooks/cloud-evidence.md): which
 * evidence a PR needs, from the paths it changes. The CLI is run exactly as the
 * `cloud-evidence-scope` job runs it (file list on stdin); classify() is checked per rule.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/cloud-evidence-scope.mjs");
const SHA = "6551f32685815626ea1106a5f76c22a7e4093129";

function cli(stdin: string, env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [SCRIPT],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HEAD_SHA: SHA, PR_NUMBER: "41", ...env } as unknown as NodeJS.ProcessEnv },
      (error: ExecFileException | null, stdout: string, stderr: string) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` })
    );
    child.stdin?.end(stdin);
  });
}

type Evidence = "migration" | "pgtap" | "authConfig" | "authProduct";
interface Classified {
  before: Array<{ id: Evidence; files: string[] }>;
  afterMerge: Array<{ id: Evidence }>;
  review: string[];
}
const ids = (items: Array<{ id: Evidence }>) => items.map((item) => item.id);
const scope = (...paths: string[]) => classify(paths) as Classified;

describe("cloud evidence scope (scripts/ci/cloud-evidence-scope.mjs)", () => {
  it.each<[string, string, Evidence[]]>([
    ["a migration (schema, RLS, grants)", "supabase/migrations/20261010000000_admin_rls.sql", ["migration", "pgtap", "authConfig"]],
    ["a pgTAP test", "supabase/tests/database/bb03_security.test.sql", ["pgtap"]],
    ["the seed", "supabase/seed.sql", ["pgtap"]],
    ["admin session code", "src/server/auth/admin-session.ts", ["authProduct"]],
    ["the admin_memberships gate", "src/server/catalog/admin-access.ts", ["authProduct"]],
    // loadAdminCatalog: requireStoreAdmin before reading the private catalog, and same-store check.
    ["the admin catalog service (loadAdminCatalog)", "src/server/catalog/catalog-service.ts", ["authProduct"]],
    // getAdminCatalog: the only entry point to the admin catalog (session client, admin scope, gate).
    ["the admin catalog entry point (getAdminCatalog)", "src/server/catalog/index.ts", ["authProduct"]],
    // BB-12: catalog writes authorize through the gate and write with the session client.
    ["the admin catalog writes", "src/server/catalog-admin/catalog-admin-service.ts", ["authProduct"]],
    ["the admin catalog Storage/RLS repository", "src/server/catalog-admin/supabase-catalog-admin-repository.ts", ["authProduct"]],
    // BB-13: store/promotion writes and the shared admin gate.
    ["the store and promotion admin writes", "src/server/store-admin/store-admin-service.ts", ["authProduct"]],
    ["the shared admin use-case gate", "src/server/admin/use-case.ts", ["authProduct"]],
    ["the SSR cookie client", "src/server/supabase/clients.ts", ["authProduct"]],
    ["session refresh", "src/server/supabase/update-session.ts", ["authProduct"]],
    ["Supabase config validation", "src/server/supabase/config.ts", ["authProduct"]],
    ["the session proxy", "src/proxy.ts", ["authProduct"]],
    ["an admin route", "src/app/bunker/admin/layout.tsx", ["authProduct"]],
    ["the login Server Action", "src/app/bunker/actions.ts", ["authProduct"]],
    ["the service worker routes (NetworkOnly admin)", "src/app/sw-routes.ts", ["authProduct"]],
    ["the Auth E2E suite", "tests/e2e/admin-auth.spec.ts", ["authProduct"]],
    ["the Auth Playwright config", "playwright.admin-auth.config.ts", ["authProduct"]]
  ])("requires pre-merge evidence for %s", (_case, file, expected) => {
    const result = scope(file);
    expect(ids(result.before)).toEqual(expected);
    expect(result.afterMerge).toEqual([]);
  });

  it.each<[string, string, Evidence[]]>([
    ["the pgTAP workflow", ".github/workflows/cloud-db-reviewed.yml", ["pgtap"]],
    ["the Auth config workflow", ".github/workflows/admin-auth-reviewed.yml", ["authConfig"]],
    ["the Auth config harness", "scripts/check-admin-auth-cloud.mjs", ["authConfig"]],
    ["the Auth product workflow", ".github/workflows/admin-auth-product-reviewed.yml", ["authProduct"]],
    ["the development preflight", "scripts/ci/preflight-supabase-dev.mjs", ["authProduct"]]
  ])("routes %s to a run from main after merge, never to a pre-merge run", (_case, file, expected) => {
    const result = scope(file);
    expect(result.before).toEqual([]);
    expect(ids(result.afterMerge)).toEqual(expected);
  });

  it.each([
    ["the CI workflow", ".github/workflows/ci.yml"],
    ["the status verifier", "scripts/ci/verify-cloud-statuses.mjs"],
    ["this classifier", "scripts/ci/cloud-evidence-scope.mjs"]
  ])("asks only for maintainer review for %s", (_case, file) => {
    const result = scope(file);
    expect(result.before).toEqual([]);
    expect(result.afterMerge).toEqual([]);
    expect(result.review).toEqual([expect.stringContaining(file)]);
  });

  it.each([
    ["public menu", "src/components/storefront/storefront.tsx"],
    ["payments", "src/server/payments/mercado-pago.ts"],
    ["public catalog adapters", "src/server/catalog/adapters.ts"],
    ["the catalog repository", "src/server/catalog/supabase-catalog-repository.ts"],
    ["the home page (only shows or hides the Admin tab; /bunker authorizes)", "src/app/page.tsx"],
    ["the in-memory admin access test double", "src/server/catalog/in-memory-admin-access.ts"],
    ["generated types", "src/server/supabase/database.types.ts"],
    ["public e2e", "tests/e2e/menu.spec.ts"],
    ["docs", "docs/runbooks/cloud-evidence.md"],
    ["a path that only contains 'bunker'", "src/app/bunker-like/page.tsx"],
    ["a lookalike migrations folder", "docs/supabase/migrations/notes.md"]
  ])("requires nothing for %s", (_case, file) => {
    expect(scope(file)).toEqual({ before: [], afterMerge: [], review: [] });
  });

  it("merges and deduplicates evidence across files, in a stable order", () => {
    const result = scope("src/server/auth/admin-session.ts", "supabase/migrations/a.sql", "src/proxy.ts", "supabase/tests/database/x.sql");
    expect(ids(result.before)).toEqual(["migration", "pgtap", "authConfig", "authProduct"]);
    expect(result.before.find((item) => item.id === "authProduct")?.files).toHaveLength(2);
  });

  it("reports the requirement for the exact HEAD SHA from the CI file list", async () => {
    const result = await cli("src/server/auth/admin-session.ts\nsupabase/migrations/20261010000000_x.sql\n");
    expect(result.code).toBe(0);
    expect(result.output).toContain(`PR #41 @ \`${SHA}\``);
    expect(result.output).toContain("**pgTAP cloud** — `cloud/pgTAP-reviewed`");
    expect(result.output).toContain("**Auth config (harness de main)** — `cloud/admin-auth-reviewed`");
    expect(result.output).toContain("**Auth producto (integración 2/2 + E2E 3/3)** — `cloud/admin-auth-product-reviewed`");
    expect(result.output).toContain("::notice title=Evidencia cloud requerida::pgTAP cloud (cloud/pgTAP-reviewed) antes del merge");
    expect(result.output).toContain("no ejecuta nada en la nube ni reemplaza pgTAP o los tests Auth");
  });

  it("warns, for migrations, that pgTAP/Auth success does not validate the migration and its effect is unverified", async () => {
    const result = await cli("supabase/migrations/20261011000000_new_policy.sql\n");
    expect(result.code).toBe(0);
    expect(result.output).toContain("**Migración: delta SQL revisado + dry-run del SHA; efecto real sólo con destino aislado**");
    expect(result.output).toContain("corren contra el esquema cloud **ya aplicado**; no aplican ni ejecutan la migración nueva, así que su success **no valida la migración**");
    expect(result.output).toContain("El dry-run sólo lista qué migraciones se aplicarían; no ejecuta su SQL.");
    expect(result.output).toContain("el **efecto de la migración queda NO verificado**");
    expect(result.output).toContain("decisión explícita del mantenedor");
    expect(result.output).toContain("::warning title=Migración sin validación automática::");
    // The warning comes before the list of runs, so it is read first.
    expect(result.output.indexOf("Atención — migraciones")).toBeLessThan(result.output.indexOf("**pgTAP cloud**"));
  });

  it("does not show the migration warning when only pgTAP tests change", async () => {
    const result = await cli("supabase/tests/database/bb03_security.test.sql\n");
    expect(result.code).toBe(0);
    expect(result.output).toContain("**pgTAP cloud**");
    expect(result.output).not.toContain("Atención — migraciones");
    expect(result.output).not.toContain("::warning");
  });

  it("asks for Auth product evidence end to end when the admin catalog service changes", async () => {
    const result = await cli("src/server/catalog/catalog-service.ts\n");
    expect(result.code).toBe(0);
    expect(result.output).toContain("**Auth producto (integración 2/2 + E2E 3/3)**");
    expect(result.output).toContain("src/server/catalog/catalog-service.ts (loadAdminCatalog: gate admin y tienda del admin)");
  });

  it("says no cloud evidence is needed when nothing in scope changed (CRLF list too)", async () => {
    const result = await cli("src/components/storefront/storefront.tsx\r\nREADME.md\r\n");
    expect(result.code).toBe(0);
    expect(result.output).toContain("no se requiere evidencia cloud");
    expect(result.output).not.toContain("::notice");
  });

  it("flags trusted infrastructure for validation by the first run from main after merge", async () => {
    const result = await cli(".github/workflows/cloud-db-reviewed.yml\n");
    expect(result.code).toBe(0);
    expect(result.output).toContain("se valida con el primer run desde main posterior al merge");
    expect(result.output).toContain("::notice title=Infra cloud modificada::pgTAP cloud");
    expect(result.output).not.toContain("Antes del merge");
  });

  it("fails instead of reporting 'nothing needed' when the file list is empty", async () => {
    const result = await cli("\n \n");
    expect(result.code).toBe(1);
    expect(result.output).toContain("Lista de archivos de la PR vacía o ilegible");
    expect(result.output).not.toContain("no se requiere evidencia cloud");
  });
});
