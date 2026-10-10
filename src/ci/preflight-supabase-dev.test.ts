import { execFile, type ExecFileException } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/*
 * The development-project preflight exactly as admin-auth-product-reviewed.yml runs it: `node
 * scripts/ci/preflight-supabase-dev.mjs` in a child process, with the same variables the step
 * passes. Values are fixtures; nothing contacts a real service.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/preflight-supabase-dev.mjs");
const REF = "zokkgocmcaqcujltfkjf";
const OTHER_REF = "abcdefghijklmnopqrst";
const PASSWORD = "fixture-password-never-printed";
const PUBLISHABLE = "sb_publishable_fixtureKeyNeverPrinted";

function jwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.fixture-signature`;
}

const valid = {
  EXPECTED_PROJECT_REF: REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  SUPABASE_TEST_ADMIN_EMAIL: "owner@example.com",
  SUPABASE_TEST_ADMIN_PASSWORD: PASSWORD
};

function run(args: string[], env: Record<string, string>): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { encoding: "utf8", env: env as unknown as NodeJS.ProcessEnv },
      (error: ExecFileException | null, stdout: string, stderr: string) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` })
    );
  });
}

function preflight(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [key, value] of Object.entries({ ...valid, ...overrides })) if (value !== undefined) env[key] = value;
  return run([], env);
}

const fixtures = mkdtempSync(path.join(tmpdir(), "bb11-environment-"));
afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

/** Shape of GET /repos/:repo/environments/admin-auth-product, protected as the runbook requires. */
const protectedEnvironment = {
  name: "admin-auth-product",
  can_admins_bypass: false,
  protection_rules: [{ id: 1, type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "Lautaro073" } }] }],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }
};

/** Runs the real script in its `authorize` mode on a JSON file (or a missing one). */
function environmentCheck(environment: unknown, raw?: string) {
  const file = path.join(fixtures, `environment-${Math.random().toString(36).slice(2)}.json`);
  if (environment !== undefined || raw !== undefined) writeFileSync(file, raw ?? JSON.stringify(environment));
  return run(["--environment-protection", file], { PATH: process.env.PATH ?? "" });
}

function expectNoSecrets(output: string) {
  expect(output).not.toContain(PASSWORD);
  expect(output).not.toContain(PUBLISHABLE);
  expect(output).not.toContain("owner@example.com");
  expect(output).not.toContain("supabase.co");
}

describe("development project preflight (scripts/ci/preflight-supabase-dev.mjs, as the workflow runs it)", () => {
  it.each([
    ["the exact canonical URL with a publishable key", {}],
    ["a trailing slash on the canonical URL", { NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co/` }],
    ["a legacy anon JWT of this project", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: REF }) }]
  ])("passes with %s", async (_case, overrides) => {
    const result = await preflight(overrides);
    expect(result.code).toBe(0);
    expect(result.output).toContain(`Preflight OK: proyecto development ${REF} verificado`);
    expectNoSecrets(result.output);
  });

  it.each<[string, Record<string, string | undefined>, RegExp]>([
    ["another project ref", { NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }, /otro proyecto o dominio/],
    ["the production project (any ref but the expected one)", { NEXT_PUBLIC_SUPABASE_URL: "https://prodprodprodprodprod.supabase.co" }, /otro proyecto o dominio/],
    ["a look-alike domain", { NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co.evil.example` }, /otro proyecto o dominio/],
    ["a non-Supabase host", { NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, /otro proyecto o dominio/],
    ["a non-HTTPS URL", { NEXT_PUBLIC_SUPABASE_URL: `http://${REF}.supabase.co` }, /debe usar https/],
    ["a URL with a path", { NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co/rest/v1` }, /URL canónica/],
    ["a URL with credentials", { NEXT_PUBLIC_SUPABASE_URL: `https://user:pass@${REF}.supabase.co` }, /URL canónica/],
    ["a URL with a port", { NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co:8443` }, /URL canónica/],
    ["a URL that does not parse", { NEXT_PUBLIC_SUPABASE_URL: "not a url" }, /no es una URL/],
    ["a missing URL", { NEXT_PUBLIC_SUPABASE_URL: undefined }, /Falta NEXT_PUBLIC_SUPABASE_URL/],
    ["a secret key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_fixtureNeverPrinted" }, /clave es secreta/],
    ["a service_role JWT", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "service_role", ref: REF }) }, /no es anon \(role service_role\)/],
    ["an anon JWT of another project", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: OTHER_REF }) }, /JWT anon pertenece a otro proyecto/],
    ["a key that is neither publishable nor a JWT", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "random-value" }, /ni un JWT anon/],
    ["a missing key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, /Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/],
    ["missing admin e-mail", { SUPABASE_TEST_ADMIN_EMAIL: undefined }, /Falta SUPABASE_TEST_ADMIN_EMAIL/],
    ["missing admin password", { SUPABASE_TEST_ADMIN_PASSWORD: undefined }, /Falta SUPABASE_TEST_ADMIN_PASSWORD/],
    ["no expected ref", { EXPECTED_PROJECT_REF: undefined }, /EXPECTED_PROJECT_REF inválido/],
    ["a malformed expected ref", { EXPECTED_PROJECT_REF: "zokkgocmcaqcujltfkjf.evil" }, /EXPECTED_PROJECT_REF inválido/]
  ])("fails closed with %s", async (_case, overrides, reason) => {
    const result = await preflight(overrides);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(reason);
    expect(result.output).not.toContain("Preflight OK");
    expectNoSecrets(result.output);
  });
});

describe("admin-auth-product environment protection (same script, `authorize` mode)", () => {
  it.each([
    ["required reviewers, no admin bypass and protected branches", protectedEnvironment],
    ["a custom branch policy", { ...protectedEnvironment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }]
  ])("lets authorize continue with %s", async (_case, environment) => {
    const result = await environmentCheck(environment);
    expect(result.code).toBe(0);
    expect(result.output).toContain("Entorno admin-auth-product protegido: 1 reviewer(s)");
  });

  it.each<[string, unknown, RegExp, string?]>([
    ["the environment does not exist (no file)", undefined, /no existe o no se pudo leer/],
    ["the API answer is not JSON", undefined, /no existe o no se pudo leer/, "<html>Not Found</html>"],
    ["another environment", { ...protectedEnvironment, name: "main" }, /no es el entorno esperado/],
    ["no protection rules at all", { ...protectedEnvironment, protection_rules: [] }, /debe exigir required reviewers/],
    ["only a wait timer", { ...protectedEnvironment, protection_rules: [{ id: 2, type: "wait_timer", wait_timer: 5 }] }, /debe exigir required reviewers/],
    ["a reviewers rule with nobody in it", { ...protectedEnvironment, protection_rules: [{ id: 1, type: "required_reviewers", reviewers: [] }] }, /debe exigir required reviewers/],
    ["admins allowed to bypass", { ...protectedEnvironment, can_admins_bypass: true }, /no deben poder saltear/],
    ["bypass setting absent", { ...protectedEnvironment, can_admins_bypass: undefined }, /no deben poder saltear/],
    ["no branch policy (any branch, including a PR workflow, could deploy)", { ...protectedEnvironment, deployment_branch_policy: null }, /política de ramas/],
    ["an empty branch policy", { ...protectedEnvironment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: false } }, /política de ramas/]
  ])("makes authorize FAIL when %s", async (_case, environment, reason, raw) => {
    const result = await environmentCheck(environment, raw);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(reason);
    expect(result.output).not.toContain("protegido:");
  });
});
