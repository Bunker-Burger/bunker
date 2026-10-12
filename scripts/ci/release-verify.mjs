#!/usr/bin/env node
/*
 * After `vercel deploy --prod` (R1 H3, docs/runbooks/release.md): proves that what is live is the
 * commit just published and that it works.
 *
 * 1. The immutable deployment URL returned by the deploy is READY, production, of this project and
 *    carries this commit (`githubCommitSha`).
 * 2. Smoke test of that immutable URL. Vercel protects deployment URLs, so the requests carry the
 *    project's automation bypass (read from the API, masked, never printed).
 * 3. The public alias points to that same deployment id (bounded retries while it propagates).
 * 4. Smoke test of the public alias.
 *
 * Any API error, mismatch or failed check exits 1. Dependency-free; tested against local stand-ins
 * of the Vercel API and the sites (src/ci/release-verify.test.ts).
 */

import { pathToFileURL } from "node:url";
import { smoke } from "./smoke-production.mjs";

async function vercel(env, path) {
  const api = (env.VERCEL_API_URL || "https://api.vercel.com").replace(/\/+$/, "");
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${api}${path}${separator}teamId=${encodeURIComponent(env.VERCEL_ORG_ID ?? "")}`, {
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`La API de Vercel respondió ${response.status} en ${path.split("?")[0]}.`);
  return response.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The deployment the deploy returned: ready, production, this project, this commit. */
export function deploymentFindings(deployment, { sha, projectId }) {
  const findings = [];
  if (!deployment || typeof deployment !== "object" || typeof deployment.id !== "string") return ["Vercel no devolvió el deployment publicado."];
  if (deployment.readyState !== "READY") findings.push(`El deployment publicado no está listo (${JSON.stringify(deployment.readyState ?? null)}).`);
  if (deployment.target !== "production") findings.push("El deployment publicado no es de producción.");
  if (deployment.projectId !== projectId) findings.push("El deployment publicado es de otro proyecto de Vercel.");
  if (deployment.meta?.githubCommitSha !== sha) findings.push("El deployment publicado no lleva el commit que se quería publicar.");
  return findings;
}

/** The automation bypass of the project, or null. */
export function automationBypass(project) {
  const entry = Object.entries(project?.protectionBypass ?? {}).find(([, value]) => value?.scope === "automation-bypass");
  return entry ? entry[0] : null;
}

export async function verifyRelease({ deploymentUrl, aliasUrl, env, mercadoPago = false, log = console.log }) {
  const findings = [];
  const sha = (env.SHA ?? "").trim().toLowerCase();
  const projectId = env.VERCEL_PROJECT_ID ?? "";
  const attempts = Math.max(1, Number(env.RELEASE_VERIFY_ATTEMPTS ?? 10));
  const delay = Math.max(0, Number(env.RELEASE_VERIFY_DELAY_MS ?? 6000));

  const deploymentHost = new URL(deploymentUrl).host;
  const deployment = await vercel(env, `/v13/deployments/${encodeURIComponent(deploymentHost)}`);
  findings.push(...deploymentFindings(deployment, { sha, projectId }));
  if (findings.length) return findings;

  const bypass = automationBypass(await vercel(env, `/v9/projects/${encodeURIComponent(projectId)}`));
  if (!bypass) return ["El proyecto no tiene bypass de automatización: no se puede probar la URL inmutable del deployment."];
  // Masked before any use: GitHub hides it in every later line of the log.
  log(`::add-mask::${bypass}`);

  const results = await smoke(deploymentUrl, { mercadoPago, headers: { "x-vercel-protection-bypass": bypass } });
  for (const result of results) {
    if (result.ok) log(`ok   deployment ${result.name}: ${result.detail}`);
    else findings.push(`Deployment publicado, ${result.name}: ${result.detail}`);
  }
  if (findings.length) return findings;

  const aliasHost = new URL(aliasUrl).host;
  let pointsTo = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    pointsTo = (await vercel(env, `/v4/aliases/${encodeURIComponent(aliasHost)}`))?.deploymentId ?? null;
    if (pointsTo === deployment.id) break;
    if (attempt < attempts) await sleep(delay);
  }
  if (pointsTo !== deployment.id) return [`El alias ${aliasHost} sigue apuntando a otro deployment después de ${attempts} intentos.`];
  log(`ok   alias ${aliasHost} → ${deployment.id}`);

  for (const result of await smoke(aliasUrl, { mercadoPago })) {
    if (result.ok) log(`ok   alias ${result.name}: ${result.detail}`);
    else findings.push(`Alias público, ${result.name}: ${result.detail}`);
  }
  return findings;
}

export async function main(argv, env = process.env) {
  const urls = argv.filter((arg) => !arg.startsWith("--"));
  const [deploymentUrl, aliasUrl] = urls;
  if (urls.length !== 2 || !/^https?:\/\//.test(deploymentUrl ?? "") || !/^https?:\/\//.test(aliasUrl ?? "") || !/^[0-9a-f]{40}$/.test(env.SHA ?? "")) {
    console.log("::error::Uso: SHA=<sha> release-verify.mjs <url del deployment> <url del alias> [--mercado-pago]");
    return 1;
  }
  let findings;
  try {
    findings = await verifyRelease({ deploymentUrl, aliasUrl, env, mercadoPago: argv.includes("--mercado-pago") });
  } catch (error) {
    findings = [error instanceof Error ? error.message : String(error)];
  }
  for (const finding of findings) console.log(`::error::${finding}`);
  if (!findings.length) console.log("Producción verificada: el alias sirve el deployment de este commit y el smoke pasa en ambos.");
  return findings.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
