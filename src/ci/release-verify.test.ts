import { execFile, type ExecFileException } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/*
 * R1 H3/H4 of PR #53: scripts/ci/main-head.mjs and scripts/ci/release-verify.mjs run as
 * vercel-production.yml runs them, against local stand-ins of the GitHub API, the Vercel API and
 * the published sites. Every id, token and bypass is a fixture; no order or payment is created.
 */

const MAIN_HEAD = path.resolve(__dirname, "../../scripts/ci/main-head.mjs");
const VERIFY = path.resolve(__dirname, "../../scripts/ci/release-verify.mjs");
const SHA = "1111111111111111111111111111111111111111";
const NEWER = "2222222222222222222222222222222222222222";
const TOKEN = "fixture-vercel-token";
const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const BYPASS = "fixture-bypass-0123456789abcdef0123";
const NEW_ID = "dpl_new";
const OLD_ID = "dpl_old";

type Handler = (request: IncomingMessage, url: URL) => { status: number; body: unknown; type?: string };

const servers: Server[] = [];
async function serve(handler: Handler): Promise<string> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    request.on("end", () => {
      const answer = handler(request, new URL(request.url ?? "/", "http://x"));
      response.writeHead(answer.status, { "content-type": answer.type ?? "application/json" });
      response.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function run(script: string, args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv }, (error: ExecFileException | null, stdout: string, stderr: string) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, output: `${stdout}${stderr}` })
    );
  });
}

describe("main-head.mjs: no publicar un commit que ya no es el HEAD de main (R1 H4)", () => {
  const github = (head: () => unknown, status = 200) =>
    serve((request, url) => {
      if (request.headers.authorization !== "Bearer gh-fixture") return { status: 401, body: {} };
      if (url.pathname !== "/repos/Bunker-Burger/bunker/git/ref/heads/main") return { status: 404, body: {} };
      return { status, body: { object: { sha: head() } } };
    });
  const ask = (api: string, sha = SHA) => run(MAIN_HEAD, [sha], { GITHUB_API_URL: api, GITHUB_REPOSITORY: "Bunker-Burger/bunker", GH_TOKEN: "gh-fixture" });

  it("a race: current before the build, stale right before the deploy", async () => {
    let head = SHA;
    const api = await github(() => head);
    expect(await ask(api)).toMatchObject({ code: 0, stdout: "true\n" });
    head = NEWER; // main moves while the build runs
    const recheck = await ask(api);
    expect(recheck).toMatchObject({ code: 0, stdout: "false\n" });
    expect(recheck.output).toContain("no se publica");
  });

  it.each<[string, () => Promise<string>, string]>([
    ["the API errors", () => github(() => SHA, 500), "GitHub respondió 500"],
    ["the API answers no SHA", () => github(() => "nope"), "no devolvió un SHA válido"],
    ["the token is refused", () => serve(() => ({ status: 401, body: {} })), "GitHub respondió 401"]
  ])("fails (exit 1, nothing on stdout) when %s", async (_case, api, message) => {
    const result = await ask(await api());
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.output).toContain(message);
  });

  it("rejects an incomplete SHA", async () => {
    expect((await ask(await github(() => SHA), SHA.slice(0, 7))).code).toBe(1);
  });
});

describe("release-verify.mjs: el alias sirve el deployment publicado y ambos pasan el smoke (R1 H3)", () => {
  const healthySite = (requireBypass: boolean, broken: (path: string) => boolean = () => false): Handler => (request, url) => {
    if (requireBypass && request.headers["x-vercel-protection-bypass"] !== BYPASS) return { status: 401, body: "protegido", type: "text/html" };
    if (broken(url.pathname)) return { status: 500, body: "error", type: "text/html" };
    switch (`${request.method} ${url.pathname}`) {
      case "GET /":
        return { status: 200, type: "text/html", body: "<h1>LA CARTA DEL BÚNKER</h1>" };
      case "GET /api/store/products":
        return { status: 200, body: { products: [], categories: [] } };
      case "GET /api/store/status":
        return { status: 200, body: { acceptingOrders: false } };
      case "POST /api/checkout/whatsapp":
        return { status: 400, body: { error: "invalid_request" } };
      case "GET /bunker":
        return { status: 200, type: "text/html", body: "Administración <button>Ingresar</button>" };
      case "GET /legal/privacidad":
        return { status: 200, type: "text/html", body: "Privacidad" };
      default:
        return { status: 404, body: {} };
    }
  };

  interface World {
    deployment?: Record<string, unknown>;
    aliasTargets?: string[];
    bypass?: boolean;
    apiStatus?: number;
    newSite?: Handler;
    aliasSite?: Handler;
  }

  async function world(options: World = {}) {
    const deploymentUrl = await serve(options.newSite ?? healthySite(true));
    const aliasUrl = await serve(options.aliasSite ?? healthySite(false));
    const targets = [...(options.aliasTargets ?? [NEW_ID])];
    const api = await serve((request, url) => {
      if (request.headers.authorization !== `Bearer ${TOKEN}` || url.searchParams.get("teamId") !== TEAM) return { status: 403, body: {} };
      if (options.apiStatus) return { status: options.apiStatus, body: {} };
      if (url.pathname === `/v13/deployments/${encodeURIComponent(new URL(deploymentUrl).host)}`) {
        return { status: 200, body: { id: NEW_ID, readyState: "READY", target: "production", projectId: PROJECT, meta: { githubCommitSha: SHA }, ...options.deployment } };
      }
      if (url.pathname === `/v9/projects/${PROJECT}`) {
        return { status: 200, body: { id: PROJECT, protectionBypass: options.bypass === false ? {} : { [BYPASS]: { scope: "automation-bypass" } } } };
      }
      if (url.pathname === `/v4/aliases/${encodeURIComponent(new URL(aliasUrl).host)}`) {
        return { status: 200, body: { deploymentId: targets.length > 1 ? targets.shift() : targets[0] } };
      }
      return { status: 404, body: {} };
    });
    return run(VERIFY, [deploymentUrl, aliasUrl], {
      VERCEL_API_URL: api,
      VERCEL_TOKEN: TOKEN,
      VERCEL_ORG_ID: TEAM,
      VERCEL_PROJECT_ID: PROJECT,
      SHA,
      RELEASE_VERIFY_ATTEMPTS: "3",
      RELEASE_VERIFY_DELAY_MS: "1"
    });
  }

  it("matching and healthy: green, with the bypass masked and never printed elsewhere", async () => {
    const result = await world();
    expect(result.code).toBe(0);
    expect(result.output).toContain("Producción verificada");
    expect(result.output).toContain(`ok   alias 127.0.0.1`);
    const lines = result.output.split("\n").filter((line) => line.includes(BYPASS));
    expect(lines).toEqual([`::add-mask::${BYPASS}`]);
    expect(result.output).not.toContain(TOKEN);
  });

  it("the alias catching up within the retries is fine", async () => {
    expect((await world({ aliasTargets: [OLD_ID, NEW_ID] })).code).toBe(0);
  });

  it("new deployment answers 500 while the old alias answers 200: red", async () => {
    const result = await world({ newSite: healthySite(true, (path) => path === "/"), aliasTargets: [OLD_ID] });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::Deployment publicado, carta: \/ respondió 500/);
  });

  it("the alias keeps pointing to another deployment: red, even if that site is healthy", async () => {
    const result = await world({ aliasTargets: [OLD_ID] });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::El alias 127\.0\.0\.1:\d+ sigue apuntando a otro deployment después de 3 intentos/);
  });

  it("the alias points to the new deployment but fails its smoke: red", async () => {
    const result = await world({ aliasSite: healthySite(false, (path) => path === "/api/store/products") });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::Alias público, productos/);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["another commit", { meta: { githubCommitSha: NEWER } }, /no lleva el commit/],
    ["a deployment without commit", { meta: {} }, /no lleva el commit/],
    ["a deployment still building", { readyState: "BUILDING" }, /no está listo/],
    ["a preview deployment", { target: null }, /no es de producción/],
    ["another project", { projectId: "prj_other" }, /otro proyecto/]
  ])("the published deployment is %s: red before any smoke", async (_case, deployment, message) => {
    const result = await world({ deployment });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(message);
    expect(result.output).not.toContain("ok   deployment");
  });

  it("without the automation bypass the immutable URL cannot be checked: red", async () => {
    const result = await world({ bypass: false });
    expect(result.code).toBe(1);
    expect(result.output).toContain("no tiene bypass de automatización");
  });

  it("the protected deployment refuses requests without the bypass, so the smoke really used it", async () => {
    const result = await world({ newSite: (request, url) => (request.headers["x-vercel-protection-bypass"] ? { status: 401, body: "" } : healthySite(false)(request, url)) });
    expect(result.code).toBe(1);
  });

  it.each([500, 404])("a Vercel API error %i is red", async (status) => {
    const result = await world({ apiStatus: status });
    expect(result.code).toBe(1);
    expect(result.output).toContain(`La API de Vercel respondió ${status}`);
  });

  it("refuses to run without the SHA or the two URLs", async () => {
    expect((await run(VERIFY, ["https://a.example"], { SHA })).code).toBe(1);
    expect((await run(VERIFY, ["https://a.example", "https://b.example"], {})).code).toBe(1);
  });
});
