#!/usr/bin/env node
/*
 * Guards of the Vercel preview pipeline (docs/runbooks/vercel-preview.md). Dependency-free, run by
 * the two workflows exactly as tested (src/ci/vercel-preview-guard.test.ts):
 *
 * - `build-env`: in the unprivileged build of the pull request's code, before anything of that code
 *   runs: no Vercel credential nor project id may be in the environment.
 * - `dispatch`: in the trusted deploy workflow (main only), the SHA the maintainer authorized must be
 *   the open, same-repository pull request's current head, with a successful build of that SHA.
 * - `preview-env`: the Vercel project's Preview variables. There is a single Supabase project and it
 *   will be production (BB-19), so a preview gets NO variable at all: allowlist, not a denylist.
 * - `prebuilt`: the artifact to upload is a preview build, with no env files inside.
 *
 * Names are printed, never values. Exit 1 on any finding; the deploy only runs after all pass.
 */

import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Variables a Vercel Preview may have. Empty until a separate development project exists (BB-19). */
export const PREVIEW_ENV_ALLOWLIST = Object.freeze([]);

/** Known-dangerous names, only to explain the finding; anything outside the allowlist is rejected anyway. */
const DANGEROUS = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|MERCADO_PAGO_|RATE_LIMIT_|VERCEL_TOKEN$|DATABASE_URL$|POSTGRES_)/;

/** Must never reach the job that builds a pull request's code. */
export const BUILD_FORBIDDEN = Object.freeze(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);

const SHA = /^[0-9a-f]{40}$/;

/**
 * @param {Array<{ key: string, target?: string[] | string }>} envs `envs` of GET /v10/projects/:id/env
 * @returns {string[]} findings (names only)
 */
export function checkPreviewEnv(envs) {
  if (!Array.isArray(envs)) return ["La respuesta de Vercel no trae la lista de variables."];
  const findings = [];
  for (const env of envs) {
    const targets = Array.isArray(env?.target) ? env.target : [env?.target];
    if (!targets.includes("preview") || PREVIEW_ENV_ALLOWLIST.includes(env.key)) continue;
    const why = DANGEROUS.test(env.key) ? " (credencial o proyecto Supabase real)" : "";
    findings.push(`${env.key} está cargada para Preview en Vercel${why}; una preview no recibe variables.`);
  }
  return findings;
}

/**
 * Every page of GET /v10/projects/:id/env, in order (R2 H5). Fails closed: a page without `envs`
 * or a last page that still points to a next one means variables were left unread, whatever the
 * pages read so far say.
 * @param {Array<{ envs?: unknown, pagination?: { next?: unknown } | null }>} pages
 * @returns {string[]} findings (names only)
 */
export function checkPreviewEnvPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return ["No se leyó ninguna respuesta de variables de Vercel."];
  const findings = [];
  pages.forEach((page, index) => {
    if (!page || typeof page !== "object" || !Array.isArray(page.envs)) {
      findings.push(`La respuesta ${index + 1} de Vercel no trae la lista de variables.`);
      return;
    }
    findings.push(...checkPreviewEnv(page.envs));
  });
  const next = pages.at(-1)?.pagination?.next;
  if (next !== undefined && next !== null) {
    findings.push("La respuesta de variables de Vercel está incompleta (hay otra página sin leer): no se puede afirmar que Preview esté vacío.");
  }
  return findings;
}

/**
 * Names only: a forbidden variable counts as present when it has any non-empty value.
 * @param {Record<string, string | undefined>} env
 */
export function checkBuildEnv(env) {
  const findings = [];
  for (const name of BUILD_FORBIDDEN) {
    if ((env[name] ?? "").trim()) findings.push(`${name} llegó al build del código de la PR.`);
  }
  for (const name of Object.keys(env)) {
    if (/^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|MERCADO_PAGO_|RATE_LIMIT_API_KEY$)/.test(name) && (env[name] ?? "").trim()) {
      findings.push(`${name} llegó al build del código de la PR.`);
    }
  }
  return findings;
}

/**
 * @param {{
 *   repository: string,
 *   sha: string,
 *   pr: { state: string, head: { sha: string, repo: { full_name: string } | null } },
 *   runs: Array<{ head_sha: string, event: string, path: string, status: string, conclusion: string | null, id: number, head_repository?: { full_name: string } | null }>,
 *   buildWorkflow: string
 * }} input
 * @returns {{ findings: string[], runId: number | null }}
 */
export function checkDispatch({ repository, sha, pr, runs, buildWorkflow }) {
  const findings = [];
  const wanted = String(sha ?? "").trim().toLowerCase();
  if (!SHA.test(wanted)) findings.push("El SHA autorizado tiene que ser el SHA completo (40 caracteres hex).");
  if (!pr || pr.state !== "open") findings.push("La PR no está abierta.");
  const headRepo = pr?.head?.repo?.full_name;
  if (headRepo !== repository) findings.push("La PR viene de un fork o de otro repositorio: no se despliega.");
  if (pr?.head?.sha?.toLowerCase() !== wanted) {
    findings.push("El SHA autorizado no es el HEAD actual de la PR (cambió después de revisarla).");
  }
  const build = (Array.isArray(runs) ? runs : []).find(
    (run) =>
      run.head_sha?.toLowerCase() === wanted &&
      run.event === "pull_request" &&
      run.path === buildWorkflow &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      (run.head_repository?.full_name ?? repository) === repository
  );
  if (!build) findings.push(`No hay un build exitoso de ${buildWorkflow} para ese SHA.`);
  return { findings, runId: findings.length ? null : build.id };
}

/** @param {string} dir the downloaded `.vercel/output` */
export function checkPrebuilt(dir) {
  const findings = [];
  const builds = path.join(dir, "builds.json");
  if (!existsSync(path.join(dir, "config.json"))) findings.push("El artefacto no tiene config.json de Vercel.");
  if (!existsSync(builds)) {
    findings.push("El artefacto no tiene builds.json.");
  } else {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(builds, "utf8"));
    } catch {
      findings.push("builds.json no es JSON válido.");
    }
    // Exactly "preview": a missing, null or unexpected target is not a preview build (R2 H6).
    // Quoted and cut, so an artifact's string never reaches the log as a workflow command.
    if (parsed !== undefined && parsed?.target !== "preview") {
      findings.push(`builds.json declara target ${JSON.stringify(parsed?.target ?? null).slice(0, 40)}; sólo se publica "preview".`);
    }
  }
  const root = existsSync(dir) ? realpathSync(dir) : dir;
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      const relative = path.relative(root, full);
      if (/^\.env(\.|$)/.test(entry)) findings.push(`El artefacto trae un archivo de entorno: ${relative}.`);
      if (lstatSync(full).isSymbolicLink()) {
        // `vercel build` links functions to each other; a link that leaves the output would upload
        // files of the runner that deploys.
        const target = path.resolve(path.dirname(full), readlinkSync(full));
        const inside = target === root || target.startsWith(root + path.sep);
        if (!inside) findings.push(`El artefacto trae un enlace que sale del output: ${relative}.`);
        continue;
      }
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  if (existsSync(dir)) walk(root);
  return findings;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function report(findings, ok) {
  for (const finding of findings) console.log(`::error::${finding}`);
  if (!findings.length) console.log(ok);
  return findings.length ? 1 : 0;
}

export function main(argv, env = process.env) {
  const [command, ...args] = argv;
  switch (command) {
    case "build-env":
      return report(checkBuildEnv(env), "Sin credenciales de Vercel ni de Supabase en el build de la PR.");
    case "preview-env":
      return report(checkPreviewEnvPages(args.map(readJson)), "Preview de Vercel sin variables.");
    case "dispatch": {
      const { findings, runId } = checkDispatch({
        repository: env.GITHUB_REPOSITORY ?? "",
        sha: env.AUTHORIZED_SHA ?? "",
        pr: readJson(args[0]),
        runs: readJson(args[1]).workflow_runs,
        buildWorkflow: env.BUILD_WORKFLOW ?? ""
      });
      const code = report(findings, `SHA autorizado = HEAD de la PR, con build exitoso (run ${runId}).`);
      // Only the run id: the next step downloads that run's artifact.
      if (!code && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run_id=${runId}\n`);
      return code;
    }
    case "prebuilt":
      return report(checkPrebuilt(args[0] ?? ""), "Artefacto de preview sin archivos de entorno.");
    default:
      console.log("::error::Uso: vercel-preview-guard.mjs build-env | preview-env <page1.json> [<page2.json> ...] | dispatch <pr.json> <runs.json> | prebuilt <dir>");
      return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
