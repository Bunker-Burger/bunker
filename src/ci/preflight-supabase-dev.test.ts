import { execFile, type ExecFileException } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

/*
 * Fixture GitHub REST API for the `authorize` mode: GET /environments/admin-auth-product and
 * GET .../deployment-branch-policies (paged), plus GET /branches/main to model the repository
 * state the review observed (main NOT protected).
 */
const REPOSITORY = "Bunker-Burger/bunker";
const TOKEN = "ghs_fixture-token-never-printed";

interface GitHubFixture {
  environment: { status: number; body: unknown };
  /** One entry per page; `status` other than 200 makes that page fail. */
  policyPages: Array<{ status: number; body: unknown }>;
  mainBranch: unknown;
}

let github: GitHubFixture;
let server: Server;
let apiUrl: string;
const apiRequests: string[] = [];

const protectedEnvironment = {
  name: "admin-auth-product",
  can_admins_bypass: false,
  protection_rules: [{ id: 1, type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "Lautaro073" } }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }
};

const policies = (...entries: Array<{ name: string; type?: string }>) => ({
  status: 200,
  body: { total_count: entries.length, branch_policies: entries.map((entry, index) => ({ id: index + 1, type: "branch", ...entry })) }
});

/** Environment restricted to the branch `main` only: the one configuration that must pass. */
function mainOnlyFixture(): GitHubFixture {
  return {
    environment: { status: 200, body: protectedEnvironment },
    policyPages: [policies({ name: "main" })],
    // As observed by the review: GET /branches/main => protected:false.
    mainBranch: { name: "main", protected: false, protection: { enabled: false } }
  };
}

function respond(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://fixture");
  apiRequests.push(`${url.pathname}${url.search} ${request.headers.authorization === `Bearer ${TOKEN}` ? "auth" : "anon"}`);
  const base = `/repos/${REPOSITORY}`;
  if (url.pathname === `${base}/environments/admin-auth-product`) {
    return respond(response, github.environment.status, github.environment.body);
  }
  if (url.pathname === `${base}/environments/admin-auth-product/deployment-branch-policies`) {
    const page = github.policyPages[Number(url.searchParams.get("page") ?? "1") - 1];
    return page ? respond(response, page.status, page.body) : respond(response, 200, { total_count: 0, branch_policies: [] });
  }
  if (url.pathname === `${base}/branches/main`) return respond(response, 200, github.mainBranch);
  return respond(response, 404, { message: "Not Found" });
}

beforeAll(async () => {
  server = createServer(route);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  github = mainOnlyFixture();
  apiRequests.length = 0;
});

/** Runs the real script in its `authorize` mode with the variables the step provides. */
function environmentCheck() {
  return run(["--environment-protection"], {
    PATH: process.env.PATH ?? "",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_API_URL: apiUrl,
    GH_TOKEN: TOKEN
  });
}

const protectedOnly = { ...protectedEnvironment, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } };

describe("admin-auth-product environment protection (same script, `authorize` mode, fixture GitHub API)", () => {
  it("passes only for selected deployment branches consisting of exactly `main`", async () => {
    const result = await environmentCheck();
    expect(result.code).toBe(0);
    expect(result.output).toContain("Entorno admin-auth-product protegido: 1 reviewer(s), sin bypass de admins, despliegue sólo desde main.");
    expect(result.output).not.toContain(TOKEN);
    // It reads the environment AND its real branch patterns, authenticated with the read-only token.
    expect(apiRequests).toEqual([
      `/repos/${REPOSITORY}/environments/admin-auth-product auth`,
      `/repos/${REPOSITORY}/environments/admin-auth-product/deployment-branch-policies?per_page=100&page=1 auth`
    ]);
  });

  it("does not depend on main's branch protection: with main unprotected (as today), main-only still passes", async () => {
    expect(github.mainBranch).toMatchObject({ protected: false });
    expect((await environmentCheck()).code).toBe(0);
  });

  it.each<[string, (fixture: GitHubFixture) => void, RegExp]>([
    // "Protected branches only" admits any protected branch, and every branch when none is protected.
    ["protected branches only, with main unprotected", (f) => (f.environment.body = protectedOnly), /Protected branches only/],
    [
      "protected branches only, even if main were protected",
      (f) => {
        f.environment.body = protectedOnly;
        f.mainBranch = { name: "main", protected: true, protection: { enabled: true } };
      },
      /Protected branches only/
    ],
    ["selected branches with a wildcard `*`", (f) => (f.policyPages = [policies({ name: "*" })]), /rama main exacta/],
    ["selected branches with a PR branch", (f) => (f.policyPages = [policies({ name: "codex/bb-11-admin-auth" })]), /rama main exacta/],
    ["selected branches with a prefix pattern", (f) => (f.policyPages = [policies({ name: "mai*" })]), /rama main exacta/],
    ["main plus a PR pattern", (f) => (f.policyPages = [policies({ name: "main" }, { name: "codex/*" })]), /exactamente una política.*tiene 2/],
    ["main plus a tag pattern", (f) => (f.policyPages = [policies({ name: "main" }, { name: "v*", type: "tag" })]), /exactamente una política.*tiene 2/],
    ["a tag named main instead of the branch", (f) => (f.policyPages = [policies({ name: "main", type: "tag" })]), /rama main exacta/],
    ["selected branches with an empty list", (f) => (f.policyPages = [policies()]), /tiene 0/],
    [
      "incomplete pagination (total says 2, pages hold 1)",
      (f) => (f.policyPages = [{ status: 200, body: { total_count: 2, branch_policies: [{ id: 1, name: "main", type: "branch" }] } }]),
      /paginación de políticas de ramas incompleta/
    ],
    ["a malformed policies answer", (f) => (f.policyPages = [{ status: 200, body: { branch_policies: [] } }]), /respuesta de deployment-branch-policies inválida/],
    ["policies API 403", (f) => (f.policyPages = [{ status: 403, body: { message: "Resource not accessible by integration" } }]), /HTTP 403/],
    ["policies API 404", (f) => (f.policyPages = [{ status: 404, body: { message: "Not Found" } }]), /HTTP 404/],
    ["environment API 404 (does not exist)", (f) => (f.environment = { status: 404, body: { message: "Not Found" } }), /environments\/admin-auth-product respondió HTTP 404/],
    ["environment API 403", (f) => (f.environment = { status: 403, body: { message: "Forbidden" } }), /HTTP 403/],
    ["another environment", (f) => (f.environment.body = { ...protectedEnvironment, name: "main" }), /no es el entorno esperado/],
    ["no required reviewers", (f) => (f.environment.body = { ...protectedEnvironment, protection_rules: [] }), /debe exigir required reviewers/],
    ["only a wait timer", (f) => (f.environment.body = { ...protectedEnvironment, protection_rules: [{ id: 2, type: "wait_timer", wait_timer: 5 }] }), /debe exigir required reviewers/],
    ["a reviewers rule with nobody in it", (f) => (f.environment.body = { ...protectedEnvironment, protection_rules: [{ id: 1, type: "required_reviewers", reviewers: [] }] }), /debe exigir required reviewers/],
    ["admins allowed to bypass", (f) => (f.environment.body = { ...protectedEnvironment, can_admins_bypass: true }), /no deben poder saltear/],
    ["bypass setting absent", (f) => (f.environment.body = { ...protectedEnvironment, can_admins_bypass: undefined }), /no deben poder saltear/],
    ["no branch policy at all", (f) => (f.environment.body = { ...protectedEnvironment, deployment_branch_policy: null }), /sin política de ramas/],
    [
      "neither protected nor selected branches",
      (f) => (f.environment.body = { ...protectedEnvironment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: false } }),
      /ramas seleccionadas con sólo main/
    ]
  ])("makes authorize FAIL with %s", async (_case, breakIt, reason) => {
    breakIt(github);
    const result = await environmentCheck();
    expect(result.code).toBe(1);
    expect(result.output).toMatch(reason);
    expect(result.output).not.toContain("protegido:");
    expect(result.output).not.toContain(TOKEN);
  });

  it("fails closed when the repository is not provided", async () => {
    const result = await run(["--environment-protection"], { PATH: process.env.PATH ?? "", GITHUB_API_URL: apiUrl, GH_TOKEN: TOKEN });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/GITHUB_REPOSITORY inválido/);
  });
});
