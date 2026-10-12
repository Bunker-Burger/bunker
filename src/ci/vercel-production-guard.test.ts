import { execFile, type ExecFileException } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Plain Node ESM so the workflow runs it without installing app code.
// @ts-expect-error The JavaScript module carries its own runtime contract and is tested below.
import { APPROVED_PRODUCTION_REF, PRODUCTION_ENV_ALLOWLIST, checkProductionEnvNames, checkProductionEnvValues, parseDotenv } from "../../scripts/ci/vercel-production-guard.mjs";

/*
 * Guard of the production deploy (docs/runbooks/release.md). Fixture values only: no real key, URL
 * or project ref. The CLI runs as vercel-production.yml runs it.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/vercel-production-guard.mjs");
const FAKE_SECRET = "fixture-secret-value-never-printed";
/** The approved production ref is public (docs/runbooks/release.md); keys and secrets are fixtures. */
const APPROVED_URL = "https://zokkgocmcaqcujltfkjf.supabase.co";
const OTHER_REF = "abcdefghijklmnopqrst";

function cli(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv }, (error: ExecFileException | null, stdout: string, stderr: string) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` })
    );
  });
}

const temps: string[] = [];
const file = (name: string, content: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), "vercel-prod-"));
  temps.push(dir);
  const full = path.join(dir, name);
  writeFileSync(full, content);
  return full;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const env = (key: string, target: string[] = ["production"]) => ({ key, target, type: "encrypted", value: FAKE_SECRET });
const required = () => [env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), env("SUPABASE_PROJECT_ENV"), env("SUPABASE_PRODUCTION_PROJECT_REF")];
const page = (envs: unknown[], next: number | null = null) => ({ envs, pagination: { count: envs.length, next, prev: null } });

describe("names: Production sólo con las variables que la app lee", () => {
  it("accepts the required variables plus any allowed one", () => {
    expect(checkProductionEnvNames([page([...required(), env("SUPABASE_SERVICE_ROLE_KEY"), env("APP_URL"), env("PRIVACY_CONTACT_EMAIL")])])).toEqual([]);
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PROJECT_ENV", "SUPABASE_PRODUCTION_PROJECT_REF"])("fails without %s", (name) => {
    const envs = required().filter((variable) => variable.key !== name);
    expect(checkProductionEnvNames([page(envs)])).toEqual([`Falta ${name} en las variables de Production de Vercel.`]);
  });

  it("a required variable of another target does not count", () => {
    const envs = [...required().slice(1), env("NEXT_PUBLIC_SUPABASE_URL", ["preview", "development"])];
    expect(checkProductionEnvNames([page(envs)])).toEqual(["Falta NEXT_PUBLIC_SUPABASE_URL en las variables de Production de Vercel."]);
  });

  it.each(["SUPABASE_SECRET_KEY", "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD", "SUPABASE_DEV_DB_URL", "ANY_OTHER"])(
    "rejects %s in Production (allowlist)",
    (name) => {
      expect(checkProductionEnvNames([page([...required(), env(name)])])).toEqual([expect.stringMatching(new RegExp(`^${name} está cargada en Production`))]);
    }
  );

  it("ignores variables of other targets", () => {
    expect(checkProductionEnvNames([page([...required(), env("SUPABASE_TEST_ADMIN_PASSWORD", ["development"])])])).toEqual([]);
  });

  it("fails closed on incomplete or malformed answers", () => {
    expect(checkProductionEnvNames([])).toHaveLength(1);
    expect(checkProductionEnvNames([page(required(), 1760000000000)]).join("\n")).toMatch(/incompleta/);
    expect(checkProductionEnvNames([{ pagination: null }] as never).join("\n")).toMatch(/no trae la lista/);
    expect(checkProductionEnvNames([page([], 1760000000000), page(required())])).toEqual([]);
  });

  it("the allowlist is exactly what the app reads", () => {
    expect([...PRODUCTION_ENV_ALLOWLIST].sort()).toEqual(
      [
        "APP_URL",
        "MERCADO_PAGO_ACCESS_TOKEN",
        "MERCADO_PAGO_WEBHOOK_SECRET",
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "PRIVACY_CONTACT_EMAIL",
        "PRIVACY_CONTACT_WHATSAPP",
        "RATE_LIMIT_API_KEY",
        "RATE_LIMIT_TIMEOUT_MS",
        "RATE_LIMIT_UPSTREAM_URL",
        "SUPABASE_PRODUCTION_PROJECT_REF",
        "SUPABASE_PROJECT_ENV",
        "SUPABASE_SERVICE_ROLE_KEY"
      ].sort()
    );
  });

  it("CLI: names the variable, never prints values", async () => {
    const bad = await cli(["names", file("env.json", JSON.stringify(page([...required(), env("SUPABASE_SECRET_KEY")])))]);
    expect(bad.code).toBe(1);
    expect(bad.output).toContain("::error::SUPABASE_SECRET_KEY");
    expect(bad.output).not.toContain(FAKE_SECRET);
    const ok = await cli(["names", file("env.json", JSON.stringify(page(required())))]);
    expect(ok.code).toBe(0);
  });
});

/** Unsigned JWT with these claims: enough for a guard that reads claims, useless as a credential. */
const syntheticJwt = (claims: Record<string, unknown>) =>
  [{ alg: "HS256", typ: "JWT" }, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".c3ludGhldGljLXNpZ25hdHVyZQ";

describe("values: el proyecto aprobado y una clave que puede ir al navegador (R1 H1, H2)", () => {
  const good = {
    NEXT_PUBLIC_SUPABASE_URL: APPROVED_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_ABC-123",
    SUPABASE_PROJECT_ENV: "production",
    SUPABASE_PRODUCTION_PROJECT_REF: APPROVED_PRODUCTION_REF
  };

  it("pins the single approved project", () => {
    expect(APPROVED_PRODUCTION_REF).toBe("zokkgocmcaqcujltfkjf");
  });

  it("accepts the approved project with a publishable key or a legacy anon JWT of that project", () => {
    expect(checkProductionEnvValues(good)).toEqual([]);
    expect(checkProductionEnvValues({ ...good, NEXT_PUBLIC_SUPABASE_URL: `${APPROVED_URL}/`, APP_URL: "https://bunker.example" })).toEqual([]);
    expect(checkProductionEnvValues({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: syntheticJwt({ role: "anon", ref: APPROVED_PRODUCTION_REF }) })).toEqual([]);
  });

  it.each<[string, Record<string, string>, RegExp]>([
    // H1: only what may reach the browser
    ["a legacy service_role JWT", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: syntheticJwt({ role: "service_role", ref: APPROVED_PRODUCTION_REF }) }, /no es anon/],
    ["a JWT without role", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: syntheticJwt({ ref: APPROVED_PRODUCTION_REF }) }, /no es anon/],
    ["an anon JWT of another project", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: syntheticJwt({ role: "anon", ref: OTHER_REF }) }, /otro proyecto/],
    ["a malformed JWT", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "aaa.bbb" }, /ni un JWT anon/],
    ["a JWT whose payload is not JSON", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.c2ln" }, /ni un JWT anon/],
    ["a JWT whose payload is an array", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: syntheticJwt(["anon"] as never) }, /ni un JWT anon/],
    ["an arbitrary string", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "cualquier-cosa" }, /ni un JWT anon/],
    ["a secret key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_fixture" }, /clave secreta/],
    ["a bare publishable prefix", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" }, /no es una clave publishable válida/],
    ["a publishable key with spaces", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a b" }, /no es una clave publishable válida/],
    ["an empty key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }, /vacía/],
    // H2: the identity is the versioned ref, not a label
    ["another project", { NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co`, SUPABASE_PRODUCTION_PROJECT_REF: OTHER_REF }, /NEXT_PUBLIC_SUPABASE_URL no es https:\/\/zokkgocmcaqcujltfkjf/],
    ["another project with the production label and no ref", { NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co`, SUPABASE_PRODUCTION_PROJECT_REF: "" }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["an empty SUPABASE_PRODUCTION_PROJECT_REF", { SUPABASE_PRODUCTION_PROJECT_REF: "" }, /SUPABASE_PRODUCTION_PROJECT_REF tiene que ser zokkgocmcaqcujltfkjf/],
    ["a crossed SUPABASE_PRODUCTION_PROJECT_REF", { SUPABASE_PRODUCTION_PROJECT_REF: OTHER_REF }, /SUPABASE_PRODUCTION_PROJECT_REF tiene que ser/],
    ["a non-Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["an http URL", { NEXT_PUBLIC_SUPABASE_URL: `http://${APPROVED_PRODUCTION_REF}.supabase.co` }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["a URL with a path", { NEXT_PUBLIC_SUPABASE_URL: `${APPROVED_URL}/rest/v1` }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["a URL with credentials", { NEXT_PUBLIC_SUPABASE_URL: `https://u:p@${APPROVED_PRODUCTION_REF}.supabase.co` }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["a look-alike host", { NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED_PRODUCTION_REF}.supabase.co.example.com` }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["the development label", { SUPABASE_PROJECT_ENV: "development" }, /SUPABASE_PROJECT_ENV tiene que ser production/],
    ["an http APP_URL", { APP_URL: "http://bunker.example" }, /APP_URL/]
  ])("rejects %s", (_case, override, message) => {
    expect(checkProductionEnvValues({ ...good, ...override }).join("\n")).toMatch(message);
  });

  it("reads `vercel pull` files", () => {
    expect(parseDotenv(`# Created by Vercel CLI\nNEXT_PUBLIC_SUPABASE_URL="${APPROVED_URL}"\nSUPABASE_PROJECT_ENV="production"\nVERCEL_ENV="production"\n`)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: APPROVED_URL,
      SUPABASE_PROJECT_ENV: "production",
      VERCEL_ENV: "production"
    });
  });

  const dotenv = (overrides: Record<string, string>) =>
    Object.entries({ ...good, ...overrides })
      .map(([key, value]) => `${key}="${value}"`)
      .join("\n");

  it.each<[string, string]>([
    ["a secret key", `sb_secret_${FAKE_SECRET}`],
    ["a service_role JWT", syntheticJwt({ role: "service_role", ref: APPROVED_PRODUCTION_REF, note: FAKE_SECRET })]
  ])("CLI: %s in the publishable slot exits 1 without printing it", async (_case, key) => {
    const result = await cli(["values", file(".env.production.local", dotenv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }))]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(result.output).not.toContain(FAKE_SECRET);
    expect(result.output).not.toContain(key);
  });

  it("CLI: another project exits 1; the approved one exits 0", async () => {
    const other = await cli(["values", file(".env.production.local", dotenv({ NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }))]);
    expect(other.code).toBe(1);
    expect(other.output).not.toContain(OTHER_REF);
    expect((await cli(["values", file(".env.production.local", dotenv({}))])).code).toBe(0);
  });
});

describe("vercel-production.yml: sólo main, después de CI, sin publicar si algo falla", () => {
  const workflow = readFileSync(path.resolve(__dirname, "../../.github/workflows/vercel-production.yml"), "utf8").replace(/\r\n/g, "\n");
  const at = (text: string, from = 0) => {
    const index = workflow.indexOf(text, from);
    expect(index).toBeGreaterThan(-1);
    return index;
  };

  it("runs only after a green CI of a push to main, with main's code", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_run:\n {4}workflows: \[CI\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n/m);
    expect(workflow).not.toMatch(/^\s*(pull_request|pull_request_target|push|workflow_dispatch)\s*:/m);
    for (const condition of [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_branch == 'main'",
      "github.event.workflow_run.head_repository.full_name == github.repository"
    ]) {
      expect(workflow).toContain(condition);
    }
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(workflow).toMatch(/environment:\n\s+name: main/);
  });

  it("checks the variables before building, deploys once with --prod and verifies the published deployment after", () => {
    expect(at("vercel-production-guard.mjs names")).toBeLessThan(at("pull --yes --environment=production"));
    expect(at("vercel-production-guard.mjs values")).toBeLessThan(at("build --prod"));
    expect(at("build --prod")).toBeLessThan(at("deploy --prebuilt --prod"));
    expect(at("deploy --prebuilt --prod")).toBeLessThan(at('release-verify.mjs "$DEPLOYMENT_URL" "$PRODUCTION_URL"'));
    expect(workflow).toContain("DEPLOYMENT_URL: ${{ steps.deploy.outputs.url }}");
    expect(workflow.match(/--prod\b/g)).toHaveLength(2);
  });

  it("asks main's HEAD before building and again in the deploy step itself, right before publishing (R1 H4)", () => {
    const first = at('main-head.mjs "$SHA"');
    expect(first).toBeLessThan(at("pnpm install --frozen-lockfile"));
    const deployStep = at("name: Deploy (Production)");
    const recheck = at('main-head.mjs "$SHA"', deployStep);
    const skip = at('if [ "$current" != "true" ]; then', recheck);
    expect(skip).toBeLessThan(at("exit 0", skip));
    expect(at("exit 0", skip)).toBeLessThan(at("deploy --prebuilt --prod"));
    // Nothing but the skip between the check and the deploy command.
    expect(workflow.slice(recheck, at("deploy --prebuilt --prod")).split("\n").length).toBeLessThanOrEqual(6);
    // [0] header, [1] checkout, [2] the first check; every later step depends on it.
    const steps = workflow.split(/\n {6}- /).slice(3);
    expect(steps.length).toBeGreaterThanOrEqual(7);
    for (const step of steps) expect(step).toContain("steps.latest.outputs.deploy == 'true'");
    expect(steps.at(-1)).toContain("steps.deploy.outputs.url != ''");
  });

  it("keeps the token at step level", () => {
    expect(workflow.split("jobs:")[1]!.split("steps:")[0]).not.toContain("secrets.");
  });
});
