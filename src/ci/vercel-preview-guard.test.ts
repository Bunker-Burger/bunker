import { execFile, type ExecFileException } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Plain Node ESM so the workflows run it without installing app code.
// @ts-expect-error The JavaScript module carries its own runtime contract and is tested below.
import { PREVIEW_ENV_ALLOWLIST, checkBuildEnv, checkDispatch, checkPrebuilt, checkPreviewEnv, checkPreviewEnvPages } from "../../scripts/ci/vercel-preview-guard.mjs";

/*
 * Guards of the Vercel preview pipeline (docs/runbooks/vercel-preview.md). Every value below is a
 * fixture: no real token, key, id or URL. The CLI runs as the workflows run it.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/vercel-preview-guard.mjs");
const REPO = "Bunker-Burger/bunker";
const SHA = "1111111111111111111111111111111111111111";
const OTHER_SHA = "2222222222222222222222222222222222222222";
const BUILD = ".github/workflows/vercel-preview.yml";
const FAKE_SECRET = "fixture-secret-value-never-printed";
/** A Supabase project URL shaped like the real one, never the real ref. */
const FAKE_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";

function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv },
      (error: ExecFileException | null, stdout: string, stderr: string) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` })
    );
  });
}

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vercel-guard-"));
  temps.push(dir);
  return dir;
};
const json = (dir: string, name: string, value: unknown) => {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(value));
  return file;
};

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("preview-env: Preview de Vercel sin variables (R1 H2)", () => {
  const env = (key: string, target: string[] | string = ["preview"]) => ({ key, target, type: "encrypted", value: FAKE_SECRET });

  it("allows nothing: there is a single Supabase project and it will be production", () => {
    expect(PREVIEW_ENV_ALLOWLIST).toEqual([]);
  });

  it("accepts an empty Preview, and variables of other targets", () => {
    expect(checkPreviewEnv([])).toEqual([]);
    expect(checkPreviewEnv([env("NEXT_PUBLIC_SUPABASE_URL", ["production", "development"]), env("SUPABASE_SERVICE_ROLE_KEY", "production")])).toEqual([]);
  });

  it("rejects the single Supabase project labeled development (no SUPABASE_PRODUCTION_PROJECT_REF needed)", () => {
    const findings = checkPreviewEnv([
      env("NEXT_PUBLIC_SUPABASE_URL", ["development", "preview", "production"]),
      env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ["preview"]),
      env("SUPABASE_PROJECT_ENV", "preview")
    ]);
    expect(findings).toHaveLength(3);
    expect(findings.join("\n")).toMatch(/NEXT_PUBLIC_SUPABASE_URL .*credencial o proyecto Supabase real/);
  });

  it.each([
    "RATE_LIMIT_API_KEY",
    "SUPABASE_TEST_MEMBERLESS_PASSWORD",
    "SUPABASE_TEST_ADMIN_PASSWORD",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "NEXT_PUBLIC_SITE_URL",
    "ANY_FUTURE_VARIABLE"
  ])("rejects %s in Preview (allowlist, not a list of known names)", (key) => {
    expect(checkPreviewEnv([env(key)])).toEqual([expect.stringContaining(key)]);
  });

  it("fails closed on an unexpected Vercel answer", () => {
    expect(checkPreviewEnv(undefined as never)).toHaveLength(1);
  });

  it("CLI: exit 1 naming the variable, never printing its value; exit 0 when empty", async () => {
    const dir = tempDir();
    const bad = await cli(["preview-env", json(dir, "bad.json", { envs: [env("NEXT_PUBLIC_SUPABASE_URL"), { ...env("X"), value: FAKE_SUPABASE_URL }] })]);
    expect(bad.code).toBe(1);
    expect(bad.output).toContain("::error::NEXT_PUBLIC_SUPABASE_URL");
    expect(bad.output).not.toContain(FAKE_SECRET);
    expect(bad.output).not.toContain(FAKE_SUPABASE_URL);
    const ok = await cli(["preview-env", json(dir, "ok.json", { envs: [] })]);
    expect(ok).toEqual({ code: 0, output: "Preview de Vercel sin variables.\n" });
  });
});

describe("preview-env: respuestas incompletas fallan cerradas (R2 H5)", () => {
  const variable = (key: string) => ({ key, target: ["preview"], type: "encrypted", value: FAKE_SECRET });
  const page = (envs: unknown[], next: number | null | undefined = null) =>
    next === undefined ? { envs } : { envs, pagination: { count: envs.length, next, prev: null } };

  it("an empty last page with no cursor passes", () => {
    expect(checkPreviewEnvPages([page([])])).toEqual([]);
    expect(checkPreviewEnvPages([page([], undefined)])).toEqual([]);
  });

  it("an empty page that still points to a next one fails: the rest was never read", () => {
    expect(checkPreviewEnvPages([page([], 1760000000000)]).join("\n")).toMatch(/incompleta/);
  });

  it("a Preview variable on a later page fails, even when the first page is empty", () => {
    const findings = checkPreviewEnvPages([page([], 1760000000000), page([variable("NEXT_PUBLIC_SUPABASE_URL")])]);
    expect(findings).toEqual([expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL")]);
  });

  it("every page read must be complete and well formed", () => {
    expect(checkPreviewEnvPages([])).toHaveLength(1);
    expect(checkPreviewEnvPages([page([], 1760000000000), { pagination: { next: null } }]).join("\n")).toMatch(/respuesta 2/);
    expect(checkPreviewEnvPages([null as never])).toHaveLength(1);
  });

  it("CLI: an empty page with a cursor exits 1; pages read to the end pass; values never printed", async () => {
    const dir = tempDir();
    const cursor = await cli(["preview-env", json(dir, "p1.json", page([], 1760000000000))]);
    expect(cursor.code).toBe(1);
    expect(cursor.output).toMatch(/::error::.*incompleta/);
    expect(cursor.output).not.toContain("Preview de Vercel sin variables");

    const later = await cli(["preview-env", json(dir, "a.json", page([], 1760000000000)), json(dir, "b.json", page([variable("RATE_LIMIT_API_KEY")]))]);
    expect(later.code).toBe(1);
    expect(later.output).toContain("::error::RATE_LIMIT_API_KEY");
    expect(later.output).not.toContain(FAKE_SECRET);

    const complete = await cli(["preview-env", json(dir, "c.json", page([], 1760000000000)), json(dir, "d.json", page([]))]);
    expect(complete).toEqual({ code: 0, output: "Preview de Vercel sin variables.\n" });
  });
});

describe("build-env: el código de la PR no ve credenciales (R1 H1)", () => {
  it("accepts a clean environment, and empty values", () => {
    expect(checkBuildEnv({ PATH: "/bin", VERCEL_TOKEN: "", CI: "true" })).toEqual([]);
  });

  it.each(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "MERCADO_PAGO_ACCESS_TOKEN", "RATE_LIMIT_API_KEY"])(
    "rejects %s",
    (name) => {
      expect(checkBuildEnv({ [name]: FAKE_SECRET })).toEqual([expect.stringContaining(name)]);
    }
  );

  it("CLI: a token in the build environment fails without printing it", async () => {
    const leaked = await cli(["build-env"], { VERCEL_TOKEN: FAKE_SECRET });
    expect(leaked.code).toBe(1);
    expect(leaked.output).toContain("::error::VERCEL_TOKEN");
    expect(leaked.output).not.toContain(FAKE_SECRET);
    expect((await cli(["build-env"])).code).toBe(0);
  });
});

describe("dispatch: sólo el SHA revisado de una PR interna, con build exitoso (R1 H1)", () => {
  const pr = (overrides: Record<string, unknown> = {}) => ({ state: "open", head: { sha: SHA, repo: { full_name: REPO } }, ...overrides });
  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 77,
    head_sha: SHA,
    event: "pull_request",
    path: BUILD,
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: REPO },
    ...overrides
  });
  const check = (input: Record<string, unknown> = {}) =>
    checkDispatch({ repository: REPO, sha: SHA, pr: pr(), runs: [run()], buildWorkflow: BUILD, ...input });

  it("authorizes the open PR's current head with a successful build of that SHA", () => {
    expect(check()).toEqual({ findings: [], runId: 77 });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["a fork", { pr: pr({ head: { sha: SHA, repo: { full_name: "someone/bunker" } } }) }, /fork/],
    ["a deleted fork", { pr: pr({ head: { sha: SHA, repo: null } }) }, /fork/],
    ["a closed PR", { pr: pr({ state: "closed" }) }, /no está abierta/],
    ["a SHA that is no longer the head", { pr: pr({ head: { sha: OTHER_SHA, repo: { full_name: REPO } } }) }, /no es el HEAD actual/],
    ["a short SHA", { sha: SHA.slice(0, 7) }, /SHA completo/],
    ["no build at all", { runs: [] }, /No hay un build exitoso/],
    ["a failed build", { runs: [run({ conclusion: "failure" })] }, /No hay un build exitoso/],
    ["a build still running", { runs: [run({ status: "in_progress", conclusion: null })] }, /No hay un build exitoso/],
    ["a build of another SHA", { runs: [run({ head_sha: OTHER_SHA })] }, /No hay un build exitoso/],
    ["another workflow's run", { runs: [run({ path: ".github/workflows/ci.yml" })] }, /No hay un build exitoso/],
    ["a run from a push", { runs: [run({ event: "push" })] }, /No hay un build exitoso/],
    ["a run from a fork's head", { runs: [run({ head_repository: { full_name: "someone/bunker" } })] }, /No hay un build exitoso/]
  ])("rejects %s", (_case, input, message) => {
    const result = check(input);
    expect(result.runId).toBeNull();
    expect(result.findings.join("\n")).toMatch(message);
  });

  it("CLI: an unauthorized SHA exits 1 and writes no run id; the authorized one writes it", async () => {
    const dir = tempDir();
    const output = path.join(dir, "github_output");
    writeFileSync(output, "");
    const files = [json(dir, "pr.json", pr()), json(dir, "runs.json", { workflow_runs: [run()] })];
    const env = { GITHUB_REPOSITORY: REPO, BUILD_WORKFLOW: BUILD, GITHUB_OUTPUT: output };

    const denied = await cli(["dispatch", ...files], { ...env, AUTHORIZED_SHA: OTHER_SHA });
    expect(denied.code).toBe(1);
    expect(readFileSync(output, "utf8")).toBe("");

    const allowed = await cli(["dispatch", ...files], { ...env, AUTHORIZED_SHA: SHA });
    expect(allowed.code).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("run_id=77\n");
  });
});

describe("prebuilt: el artefacto es un build de preview, sin entorno ni enlaces afuera", () => {
  const output = (builds: unknown = { target: "preview" }) => {
    const dir = path.join(tempDir(), "output");
    mkdirSync(path.join(dir, "functions", "index.func"), { recursive: true });
    writeFileSync(path.join(dir, "config.json"), "{}");
    writeFileSync(path.join(dir, "builds.json"), typeof builds === "string" ? builds : JSON.stringify(builds));
    return dir;
  };

  it("accepts a preview build, including links between its own functions", () => {
    const dir = output();
    symlinkSync(path.join(dir, "functions", "index.func"), path.join(dir, "functions", "other.func"), "junction");
    expect(checkPrebuilt(dir)).toEqual([]);
  });

  it.each<[string, (dir: string) => void, RegExp]>([
    ["a production build", (dir) => writeFileSync(path.join(dir, "builds.json"), JSON.stringify({ target: "production" })), /target "production"/],
    ["an env file", (dir) => writeFileSync(path.join(dir, "functions", "index.func", ".env.production"), "X=1"), /archivo de entorno/],
    ["no config.json", (dir) => rmSync(path.join(dir, "config.json")), /config\.json/],
    ["no builds.json", (dir) => rmSync(path.join(dir, "builds.json")), /builds\.json/],
    ["a broken builds.json", (dir) => writeFileSync(path.join(dir, "builds.json"), "{"), /no es JSON/],
    ["a link out of the output", (dir) => symlinkSync(tempDir(), path.join(dir, "functions", "leak.func"), "junction"), /enlace que sale del output/]
  ])("rejects %s", (_case, mutate, message) => {
    const dir = output();
    mutate(dir);
    expect(checkPrebuilt(dir).join("\n")).toMatch(message);
  });

  // R2 H6: the target must be exactly "preview"; anything else, missing included, is rejected.
  it.each<[string, string]>([
    ["no target", "{}"],
    ["a null target", JSON.stringify({ target: null })],
    ["a production target", JSON.stringify({ target: "production" })],
    ["a differently cased target", JSON.stringify({ target: "Preview" })],
    ["a non-string target", JSON.stringify({ target: ["preview"] })],
    ["a JSON null", "null"],
    ["a JSON array", "[]"]
  ])("CLI: %s in builds.json exits 1 and is not accepted", async (_case, builds) => {
    const result = await cli(["prebuilt", output(builds)]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::builds\.json declara target .*sólo se publica "preview"/);
    expect(result.output).not.toContain("Artefacto de preview sin archivos de entorno.");
  });

  it("CLI: a preview build passes", async () => {
    expect(await cli(["prebuilt", output()])).toEqual({ code: 0, output: "Artefacto de preview sin archivos de entorno.\n" });
  });

  it("CLI: a target string never reaches the log as a workflow command", async () => {
    const result = await cli(["prebuilt", output({ target: "x\n::add-mask::y" })]);
    expect(result.code).toBe(1);
    expect(result.output).not.toMatch(/^::add-mask::/m);
  });
});

describe("workflows: el código de la PR nunca corre con credenciales (R1 H1)", () => {
  // Line endings normalized: a Windows checkout (autocrlf) must not change what the YAML says.
  const read = (name: string) => readFileSync(path.resolve(__dirname, "../../.github/workflows", name), "utf8").replace(/\r\n/g, "\n");
  const build = read("vercel-preview.yml");
  const deploy = read("vercel-preview-deploy.yml");

  it("the PR build has no secret, environment nor write permission, and builds the PR's head", () => {
    expect(build).toMatch(/^on:\n {2}pull_request:\n\n/m);
    expect(build).not.toMatch(/secrets\.|environment:|pull_request_target|write/);
    expect(build).toContain("ref: ${{ github.event.pull_request.head.sha }}");
    // The credential check runs before installing or running anything of the PR.
    const guard = build.indexOf("node scripts/ci/vercel-preview-guard.mjs build-env");
    expect(guard).toBeGreaterThan(build.indexOf("persist-credentials: false"));
    expect(guard).toBeLessThan(build.indexOf("pnpm install"));
    expect(build).not.toMatch(/--prod\b|(?:VERCEL_CLI"|vercel)\s+deploy\b/);
  });

  it("the deploy only runs by hand from main, never checks out nor installs the PR's code, never production", () => {
    expect(deploy).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(deploy).not.toMatch(/^\s*(pull_request|pull_request_target|push|workflow_run|schedule)\s*:/m);
    expect(deploy).toContain("if: github.ref == 'refs/heads/main'");
    expect(deploy).toMatch(/environment:\n\s+name: preview/);
    expect(deploy).not.toMatch(/--prod\b|--target[ =]production|ref: \$\{\{ (github\.event|inputs)/);
    expect(deploy).not.toMatch(/pnpm (install|dlx)|npm ci|npx /);
    expect(deploy).toContain("npm install --prefix \"$RUNNER_TEMP/vercel-cli\" --ignore-scripts");
  });

  it("the token reaches only the two steps after every check, never the whole job", () => {
    const steps = deploy.split(/\n {6}- /);
    const withToken = steps.filter((step) => step.includes("secrets.VERCEL_TOKEN"));
    expect(withToken.map((step) => /name: (.+)/.exec(step)?.[1])).toEqual(["Preview de Vercel sin variables", "Deploy (Preview)"]);
    const firstToken = deploy.indexOf("secrets.VERCEL_TOKEN");
    for (const guard of ["guard.mjs dispatch", "guard.mjs prebuilt"]) expect(deploy.indexOf(guard)).toBeLessThan(firstToken);
    expect(deploy.indexOf("guard.mjs preview-env")).toBeLessThan(deploy.indexOf("deploy --prebuilt"));
    expect(deploy.split("jobs:")[1]!.split("steps:")[0]).not.toContain("secrets.");
  });
});
