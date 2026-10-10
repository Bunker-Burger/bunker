import { execFile, type ExecFileException } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/*
 * The cloud evidence gate exactly as CI runs it: `node scripts/ci/verify-cloud-statuses.mjs` in a
 * child process, with the same environment variables the `status-provenance` job passes, against
 * a fixture GitHub REST API. Fixtures follow the real shape of run 38007678913 (pgTAP): a
 * workflow_dispatch run of a trusted workflow on main (head_sha = main's commit) that posted
 * success on the PR head SHA. No secrets, no network beyond localhost.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/verify-cloud-statuses.mjs");
const REPOSITORY = "Bunker-Burger/bunker";
const PR = "37";
const REVIEWED_SHA = "e2cc6d81fb85c0b520eb63eb537b781d7eb5e8f2";
const MAIN_SHA = "452881bc6d9408901335016fe791816f4760e146";
const OTHER_SHA = "d79ccc559458b4414a8af19eb5fdce7a60b392b3";
const TOKEN = "ghs_fixture-token-never-printed";

const CONTEXTS = [
  { context: "cloud/pgTAP-reviewed", workflow: ".github/workflows/cloud-db-reviewed.yml", title: "Cloud DB | pgTAP", runId: 38007678913 },
  { context: "cloud/admin-auth-reviewed", workflow: ".github/workflows/admin-auth-reviewed.yml", title: "Admin Auth config", runId: 38100000001 },
  { context: "cloud/admin-auth-product-reviewed", workflow: ".github/workflows/admin-auth-product-reviewed.yml", title: "Admin Auth producto", runId: 38100000002 }
] as const;

type Json = Record<string, unknown>;

interface Fixture {
  pr: Json;
  statuses: Json[];
  runs: Map<string, Json>;
  compare: Map<string, Json>;
}

let fixture: Fixture;
let server: Server;
let apiUrl: string;
const requests: Array<{ url: string; authorization: string | undefined }> = [];

function trustedRun(index: number, overrides: Json = {}): Json {
  const { workflow, title, runId } = CONTEXTS[index]!;
  return {
    id: runId,
    name: title,
    display_title: `${title} | PR #${PR} | ${REVIEWED_SHA}`,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: MAIN_SHA,
    path: workflow,
    status: "completed",
    conclusion: "success",
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    ...overrides
  };
}

function successStatus(index: number, overrides: Json = {}): Json {
  const { context, runId } = CONTEXTS[index]!;
  return {
    context,
    state: "success",
    target_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`,
    creator: { login: "github-actions[bot]", type: "Bot" },
    ...overrides
  };
}

function legitimateFixture(): Fixture {
  return {
    pr: { state: "open", base: { ref: "main" }, head: { sha: REVIEWED_SHA, repo: { full_name: REPOSITORY } } },
    // Newest first, as GET /statuses/:sha returns them.
    statuses: [successStatus(2), successStatus(1), successStatus(0)],
    runs: new Map(CONTEXTS.map((entry, index) => [String(entry.runId), trustedRun(index)])),
    compare: new Map([[`${MAIN_SHA}...main`, { status: "identical" }]])
  };
}

function respond(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://fixture");
  requests.push({ url: url.pathname + url.search, authorization: request.headers.authorization });
  const base = `/repos/${REPOSITORY}`;
  if (url.pathname === `${base}/pulls/${PR}`) return respond(response, 200, fixture.pr);
  if (url.pathname === `${base}/statuses/${REVIEWED_SHA}`) {
    const page = Number(url.searchParams.get("page") ?? "1");
    return respond(response, 200, page === 1 ? fixture.statuses : []);
  }
  const run = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/([0-9]+)$/.exec(url.pathname);
  if (run && url.pathname.startsWith(base)) {
    const found = fixture.runs.get(run[1]!);
    return found ? respond(response, 200, found) : respond(response, 404, { message: "Not Found" });
  }
  const compare = new RegExp(`^${base}/compare/(.+)$`).exec(url.pathname);
  if (compare) {
    const found = fixture.compare.get(decodeURIComponent(compare[1]!));
    return found ? respond(response, 200, found) : respond(response, 404, { message: "Not Found" });
  }
  return respond(response, 404, { message: "Not Found" });
}

/** Runs the real gate script with the environment the CI job provides. */
function gate(env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT],
      {
        encoding: "utf8",
        // Only what the CI step provides; nothing inherited from the test process but PATH.
        env: {
          PATH: process.env.PATH ?? "",
          GITHUB_REPOSITORY: REPOSITORY,
          GITHUB_API_URL: apiUrl,
          GITHUB_SERVER_URL: "https://github.com",
          GH_TOKEN: TOKEN,
          PR_NUMBER: PR,
          REVIEWED_SHA,
          ...env
        } as unknown as NodeJS.ProcessEnv
      },
      (error: ExecFileException | null, stdout: string, stderr: string) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` })
    );
  });
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
  fixture = legitimateFixture();
  requests.length = 0;
});

describe("cloud evidence gate (scripts/ci/verify-cloud-statuses.mjs, as run by CI)", () => {
  it("accepts trusted runs on main that reviewed this PR SHA (real shape: run.head_sha = main ≠ PR SHA)", async () => {
    const result = await gate();

    expect(result.code).toBe(0);
    for (const { context, runId } of CONTEXTS) {
      expect(result.output).toContain(`Status ${context} verificado: run ${runId}`);
    }
    expect(result.output).toContain(`en main (${MAIN_SHA}) para PR #${PR} @ ${REVIEWED_SHA}`);
    // Every API call is authenticated, and the token never reaches the output.
    expect(requests.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(result.output).not.toContain(TOKEN);
  });

  it("accepts a run of an older main commit that is still reachable from main", async () => {
    fixture.runs.set("38007678913", trustedRun(0, { head_sha: OTHER_SHA }));
    fixture.compare.set(`${OTHER_SHA}...main`, { status: "ahead" });
    expect((await gate()).code).toBe(0);
  });

  // Each case breaks exactly one link of the chain; the gate must refuse and say why.
  it.each<[string, (fixture: Fixture) => void, RegExp]>([
    ["no status for the context", (f) => (f.statuses = f.statuses.filter((s) => s.context !== "cloud/pgTAP-reviewed")), /Falta status cloud\/pgTAP-reviewed/],
    ["the newest status failed (an older success is stale)", (f) => f.statuses.unshift(successStatus(0, { state: "failure" })), /no está en success \(failure\)/],
    ["the newest status is pending", (f) => f.statuses.unshift(successStatus(0, { state: "pending" })), /no está en success \(pending\)/],
    ["a maintainer posted it by hand", (f) => (f.statuses[2] = successStatus(0, { creator: { login: "Lautaro073", type: "User" } })), /Creator no autorizado para cloud\/pgTAP-reviewed: Lautaro073/],
    ["another bot posted it", (f) => (f.statuses[2] = successStatus(0, { creator: { login: "dependabot[bot]", type: "Bot" } })), /Creator no autorizado/],
    ["the status has no creator", (f) => (f.statuses[2] = successStatus(0, { creator: null })), /Creator no autorizado/],
    ["target_url points to another repository", (f) => (f.statuses[2] = successStatus(0, { target_url: "https://github.com/evil/bunker/actions/runs/38007678913" })), /target_url inválida/],
    ["target_url is not a run", (f) => (f.statuses[2] = successStatus(0, { target_url: `https://github.com/${REPOSITORY}/pull/37` })), /target_url inválida/],
    ["target_url has a non-numeric run id", (f) => (f.statuses[2] = successStatus(0, { target_url: `https://github.com/${REPOSITORY}/actions/runs/38007678913/attempts/1` })), /target_url inválida/],
    ["the run does not exist", (f) => f.runs.delete("38007678913"), /HTTP 404/],
    ["the run is of another workflow", (f) => f.runs.set("38007678913", trustedRun(0, { path: ".github/workflows/ci.yml" })), /workflow \.github\/workflows\/ci\.yml/],
    ["the run failed", (f) => f.runs.set("38007678913", trustedRun(0, { conclusion: "failure" })), /resultado completed\/failure/],
    ["the run is still in progress", (f) => f.runs.set("38007678913", trustedRun(0, { status: "in_progress", conclusion: null })), /resultado in_progress\/null/],
    ["the run was triggered by a pull request", (f) => f.runs.set("38007678913", trustedRun(0, { event: "pull_request", head_branch: "codex/bb-11-admin-auth", head_sha: REVIEWED_SHA })), /evento pull_request/],
    ["the run came from a comment, without an input binding", (f) => f.runs.set("38007678913", trustedRun(0, { event: "issue_comment" })), /evento issue_comment/],
    ["the run did not run on main", (f) => f.runs.set("38007678913", trustedRun(0, { head_branch: "feature" })), /rama feature/],
    ["the run belongs to a fork", (f) => f.runs.set("38007678913", trustedRun(0, { head_repository: { full_name: "evil/bunker" } })), /repositorio de origen/],
    ["the run reviewed another SHA (wrong input)", (f) => f.runs.set("38007678913", trustedRun(0, { display_title: `Cloud DB | pgTAP | PR #${PR} | ${OTHER_SHA}` })), /run-name no vincula/],
    ["the run reviewed another PR", (f) => f.runs.set("38007678913", trustedRun(0, { display_title: `Cloud DB | pgTAP | PR #36 | ${REVIEWED_SHA}` })), /run-name no vincula/],
    ["the run has a static title (no binding to any SHA)", (f) => f.runs.set("38007678913", trustedRun(0, { display_title: "Cloud DB — ejecución revisada (main)" })), /run-name no vincula/],
    ["the run executed code not on main", (f) => f.compare.set(`${MAIN_SHA}...main`, { status: "diverged" }), /no ejecutó código de main \(diverged\)/],
    ["the PR head moved", (f) => (f.pr = { ...f.pr, head: { sha: OTHER_SHA, repo: { full_name: REPOSITORY } } }), /La PR cambió de SHA/],
    ["the PR is closed", (f) => (f.pr = { ...f.pr, state: "closed" }), /no está abierta hacia main/]
  ])("refuses when %s", async (_case, breakIt, reason) => {
    breakIt(fixture);
    const result = await gate();
    expect(result.code).toBe(1);
    expect(result.output).toMatch(reason);
    expect(result.output).not.toContain("verificado: run 38007678913");
  });

  it("refuses the product context when its trusted workflow never ran", async () => {
    fixture.statuses = fixture.statuses.filter((status) => status.context !== "cloud/admin-auth-product-reviewed");
    const result = await gate();
    expect(result.code).toBe(1);
    expect(result.output).toContain("Falta status cloud/admin-auth-product-reviewed");
  });

  it.each([
    ["a short SHA", { REVIEWED_SHA: "e2cc6d8" }, /REVIEWED_SHA debe ser un SHA completo/],
    ["no PR number", { PR_NUMBER: "" }, /PR_NUMBER inválido/],
    ["no repository", { GITHUB_REPOSITORY: "" }, /GITHUB_REPOSITORY inválido/]
  ])("refuses to run with %s", async (_case, env, reason) => {
    const result = await gate(env);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(reason);
  });
});
