import { execFile, type ExecFileException } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Plain Node ESM so the workflow runs it without installing app code.
// @ts-expect-error The JavaScript module carries its own runtime contract and is tested below.
import { PRODUCTION_ENV_ALLOWLIST, checkProductionEnvNames, checkProductionEnvValues, parseDotenv } from "../../scripts/ci/vercel-production-guard.mjs";

/*
 * Guard of the production deploy (docs/runbooks/release.md). Fixture values only: no real key, URL
 * or project ref. The CLI runs as vercel-production.yml runs it.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/vercel-production-guard.mjs");
const FAKE_SECRET = "fixture-secret-value-never-printed";
const FAKE_REF = "abcdefghijklmnopqrst";
const FAKE_URL = `https://${FAKE_REF}.supabase.co`;

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
const required = () => [env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), env("SUPABASE_PROJECT_ENV")];
const page = (envs: unknown[], next: number | null = null) => ({ envs, pagination: { count: envs.length, next, prev: null } });

describe("names: Production sólo con las variables que la app lee", () => {
  it("accepts the required variables plus any allowed one", () => {
    expect(checkProductionEnvNames([page([...required(), env("SUPABASE_SERVICE_ROLE_KEY"), env("APP_URL"), env("PRIVACY_CONTACT_EMAIL")])])).toEqual([]);
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PROJECT_ENV"])("fails without %s", (name) => {
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

describe("values: formato de los valores de Production", () => {
  const good = { NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_PROJECT_ENV: "production" };

  it("accepts the real-project shape", () => {
    expect(checkProductionEnvValues(good)).toEqual([]);
    expect(checkProductionEnvValues({ ...good, SUPABASE_PRODUCTION_PROJECT_REF: FAKE_REF, APP_URL: "https://bunker.example" })).toEqual([]);
  });

  it.each<[string, Record<string, string>, RegExp]>([
    ["a non-Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["an http URL", { NEXT_PUBLIC_SUPABASE_URL: `http://${FAKE_REF}.supabase.co` }, /NEXT_PUBLIC_SUPABASE_URL/],
    ["a secret key as publishable", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_fixture" }, /clave secreta/],
    ["an empty key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }, /vacía/],
    ["the development label", { SUPABASE_PROJECT_ENV: "development" }, /production/],
    ["another production ref", { SUPABASE_PRODUCTION_PROJECT_REF: "zzzzzzzzzzzzzzzzzzzz" }, /no coincide/],
    ["an http APP_URL", { APP_URL: "http://bunker.example" }, /APP_URL/]
  ])("rejects %s", (_case, override, message) => {
    expect(checkProductionEnvValues({ ...good, ...override }).join("\n")).toMatch(message);
  });

  it("reads `vercel pull` files", () => {
    expect(parseDotenv(`# Created by Vercel CLI\nNEXT_PUBLIC_SUPABASE_URL="${FAKE_URL}"\nSUPABASE_PROJECT_ENV="production"\nVERCEL_ENV="production"\n`)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: FAKE_URL,
      SUPABASE_PROJECT_ENV: "production",
      VERCEL_ENV: "production"
    });
  });

  it("CLI: a secret key in the publishable slot fails without printing it", async () => {
    const result = await cli(["values", file(".env.production.local", `NEXT_PUBLIC_SUPABASE_URL="${FAKE_URL}"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_secret_${FAKE_SECRET}"\nSUPABASE_PROJECT_ENV="production"\n`)]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::.*clave secreta/);
    expect(result.output).not.toContain(FAKE_SECRET);
  });
});

describe("vercel-production.yml: sólo main, después de CI, sin publicar si algo falla", () => {
  const workflow = readFileSync(path.resolve(__dirname, "../../.github/workflows/vercel-production.yml"), "utf8").replace(/\r\n/g, "\n");

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

  it("checks the variables before building, deploys once with --prod and smoke tests after", () => {
    const at = (text: string) => {
      const index = workflow.indexOf(text);
      expect(index).toBeGreaterThan(-1);
      return index;
    };
    expect(at("vercel-production-guard.mjs names")).toBeLessThan(at("pull --yes --environment=production"));
    expect(at("vercel-production-guard.mjs values")).toBeLessThan(at('build --prod'));
    expect(at("build --prod")).toBeLessThan(at("deploy --prebuilt --prod"));
    expect(at("deploy --prebuilt --prod")).toBeLessThan(at("smoke-production.mjs"));
    expect(workflow.match(/--prod\b/g)).toHaveLength(2);
  });

  it("never deploys an older commit over a newer one", () => {
    expect(workflow).toContain('if [ "$head" = "$SHA" ]; then echo "deploy=true"');
    // [0] header, [1] checkout, [2] the check itself; every later step depends on it.
    const steps = workflow.split(/\n {6}- /).slice(3);
    expect(steps.length).toBeGreaterThanOrEqual(7);
    for (const step of steps) expect(step).toContain("steps.latest.outputs.deploy == 'true'");
  });

  it("keeps the token at step level", () => {
    expect(workflow.split("jobs:")[1]!.split("steps:")[0]).not.toContain("secrets.");
  });
});
