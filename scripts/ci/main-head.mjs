#!/usr/bin/env node
/*
 * Is this SHA still the HEAD of main? (docs/runbooks/release.md). vercel-production.yml asks before
 * building and again right before `deploy --prod` (R1 H4): if main moved meanwhile, the older commit
 * is not published, the newer commit's own run publishes it. Dependency-free; tested against a
 * local stand-in of the GitHub API (src/ci/release-verify.test.ts).
 *
 * Prints `true` or `false` on stdout; any API or input error exits 1 (never "probably current").
 */

import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;

/** @returns {Promise<string>} the SHA main points to */
export async function mainHead({ api, repository, token }) {
  const response = await fetch(`${api.replace(/\/+$/, "")}/repos/${repository}/git/ref/heads/main`, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status} al leer main.`);
  const sha = (await response.json())?.object?.sha;
  if (typeof sha !== "string" || !SHA.test(sha)) throw new Error("GitHub no devolvió un SHA válido para main.");
  return sha;
}

export async function main(argv, env = process.env) {
  const sha = String(argv[0] ?? "").trim().toLowerCase();
  if (!SHA.test(sha)) {
    console.error("::error::Uso: main-head.mjs <sha completo>");
    return 1;
  }
  try {
    const head = await mainHead({ api: env.GITHUB_API_URL || "https://api.github.com", repository: env.GITHUB_REPOSITORY ?? "", token: env.GH_TOKEN });
    console.log(head === sha ? "true" : "false");
    if (head !== sha) console.error(`::notice::${sha} ya no es el HEAD de main (${head}): no se publica; lo publica el run de ese commit.`);
    return 0;
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
