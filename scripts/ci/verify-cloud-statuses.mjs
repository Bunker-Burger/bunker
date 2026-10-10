#!/usr/bin/env node
/*
 * Cloud evidence check for a pull request SHA. It is no longer a CI gate: run it manually (see
 * docs/runbooks/admin-auth-reviewed.md). Its tests run THIS file as a child process against a
 * fixture GitHub API. Dependency-free Node ESM: no app code, no secrets, read-only GitHub token.
 *
 * Every required context must be the newest status of the exact PR head SHA and must come from a
 * trusted workflow that runs from `main` and reviews another commit:
 *   - status: state=success, creator github-actions[bot], target_url = canonical URL of one run;
 *   - run: same repository, event workflow_dispatch, head_branch main, exact workflow path,
 *     completed/success, and its `run-name` (display_title), which the trusted workflow derives
 *     from its own inputs, names exactly this PR and this SHA;
 *   - run.head_sha is main's code (an ancestor of, or equal to, the current main), and is never
 *     required to equal the reviewed SHA: privileged runs execute main by design.
 */

export const REQUIRED_CONTEXTS = [
  { context: "cloud/pgTAP-reviewed", workflow: ".github/workflows/cloud-db-reviewed.yml", title: "Cloud DB | pgTAP" },
  { context: "cloud/admin-auth-reviewed", workflow: ".github/workflows/admin-auth-reviewed.yml", title: "Admin Auth config" },
  {
    context: "cloud/admin-auth-product-reviewed",
    workflow: ".github/workflows/admin-auth-product-reviewed.yml",
    title: "Admin Auth producto"
  }
];

const TRUSTED_CREATOR = "github-actions[bot]";
const SHA = /^[0-9a-f]{40}$/;

/** The `run-name` every trusted workflow sets: `<title> | PR #<number> | <sha>`. */
export function expectedRunTitle(title, prNumber, sha) {
  return `${title} | PR #${prNumber} | ${sha}`;
}

class GateError extends Error {}

function createApi({ apiUrl, token, fetchImpl }) {
  return async function api(path) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      redirect: "error"
    });
    if (!response.ok) throw new GateError(`GitHub API ${path} respondió HTTP ${response.status}`);
    return response.json();
  };
}

/** Newest status for `context` on `sha` (GET /statuses/:sha lists newest first). */
async function latestStatus(api, repository, sha, context) {
  for (let page = 1; page <= 10; page++) {
    const statuses = await api(`/repos/${repository}/statuses/${sha}?per_page=100&page=${page}`);
    if (!Array.isArray(statuses)) throw new GateError("Respuesta de statuses inválida");
    const found = statuses.find((status) => status?.context === context);
    if (found) return found;
    if (statuses.length < 100) return null;
  }
  return null;
}

async function verifyContext({ api, repository, serverUrl, prNumber, sha }, { context, workflow, title }) {
  const status = await latestStatus(api, repository, sha, context);
  if (!status) throw new GateError(`Falta status ${context}`);

  const state = status.state;
  const creator = status.creator?.login;
  const target = status.target_url;
  if (state !== "success") throw new GateError(`Status ${context} no está en success (${state})`);
  if (creator !== TRUSTED_CREATOR || status.creator?.type !== "Bot") {
    throw new GateError(`Creator no autorizado para ${context}: ${creator ?? "(ninguno)"}`);
  }

  const runPrefix = `${serverUrl}/${repository}/actions/runs/`;
  const runId = typeof target === "string" && target.startsWith(runPrefix) ? target.slice(runPrefix.length) : "";
  if (!/^[0-9]+$/.test(runId)) throw new GateError(`target_url inválida para ${context}`);

  const run = await api(`/repos/${repository}/actions/runs/${runId}`);
  const problems = [];
  if (run.repository?.full_name !== repository) problems.push("repositorio");
  if (run.head_repository?.full_name !== repository) problems.push("repositorio de origen");
  if (run.event !== "workflow_dispatch") problems.push(`evento ${run.event}`);
  if (run.head_branch !== "main") problems.push(`rama ${run.head_branch}`);
  if (run.path !== workflow) problems.push(`workflow ${run.path}`);
  if (run.status !== "completed" || run.conclusion !== "success") problems.push(`resultado ${run.status}/${run.conclusion}`);
  // Case-insensitive only because a dispatcher may type the SHA in upper case; the workflow's own
  // authorize job already checked that input against the PR head.
  if (
    typeof run.display_title !== "string" ||
    run.display_title.toLowerCase() !== expectedRunTitle(title, prNumber, sha).toLowerCase()
  ) {
    problems.push("run-name no vincula esta PR y este SHA");
  }
  if (typeof run.head_sha !== "string" || !SHA.test(run.head_sha)) problems.push("head_sha del run");
  if (problems.length > 0) throw new GateError(`Run ${runId} no acredita ${context}: ${problems.join(", ")}`);

  // The run executed main's code: its commit must be reachable from main.
  const comparison = await api(`/repos/${repository}/compare/${run.head_sha}...main`);
  if (comparison?.status !== "identical" && comparison?.status !== "ahead") {
    throw new GateError(`Run ${runId} no ejecutó código de main (${comparison?.status})`);
  }

  return `Status ${context} verificado: run ${runId} de ${workflow} en main (${run.head_sha}) para PR #${prNumber} @ ${sha}.`;
}

/**
 * Verifies every required context. Returns { ok, lines }: one line per verified context, or the
 * first failure. Never prints tokens.
 */
export async function verifyCloudStatuses(env = process.env, fetchImpl = globalThis.fetch, contexts = REQUIRED_CONTEXTS) {
  const lines = [];
  try {
    const repository = env.GITHUB_REPOSITORY ?? "";
    const prNumber = env.PR_NUMBER ?? "";
    const sha = (env.REVIEWED_SHA ?? "").toLowerCase();
    const apiUrl = (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
    const serverUrl = (env.GITHUB_SERVER_URL ?? "https://github.com").replace(/\/+$/, "");
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new GateError("GITHUB_REPOSITORY inválido");
    if (!/^[1-9][0-9]*$/.test(prNumber)) throw new GateError("PR_NUMBER inválido");
    if (!SHA.test(sha)) throw new GateError("REVIEWED_SHA debe ser un SHA completo");

    const api = createApi({ apiUrl, token: env.GH_TOKEN ?? env.GITHUB_TOKEN, fetchImpl });
    const pr = await api(`/repos/${repository}/pulls/${prNumber}`);
    if (pr.head?.sha !== sha) throw new GateError("La PR cambió de SHA durante la validación");
    if (pr.state !== "open" || pr.base?.ref !== "main" || pr.head?.repo?.full_name !== repository) {
      throw new GateError("La PR no está abierta hacia main desde este repositorio");
    }

    for (const required of contexts) {
      lines.push(await verifyContext({ api, repository, serverUrl, prNumber, sha }, required));
    }
    return { ok: true, lines };
  } catch (error) {
    lines.push(`::error::${error instanceof GateError ? error.message : `Error inesperado: ${error?.message ?? error}`}`);
    return { ok: false, lines };
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/ci/verify-cloud-statuses.mjs")) {
  const result = await verifyCloudStatuses();
  for (const line of result.lines) console.log(line);
  process.exit(result.ok ? 0 : 1);
}
