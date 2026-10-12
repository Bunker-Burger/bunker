#!/usr/bin/env node
/*
 * Guard of the production deploy (docs/runbooks/release.md). Dependency-free; run by
 * vercel-production.yml exactly as tested (src/ci/vercel-production-guard.test.ts). It never deploys
 * anything and never prints a value, only variable names.
 *
 * - `names <page1.json> [...]`: the Vercel project's Production variables (GET /v10/projects/:id/env,
 *   every page). Only the variables the app reads are allowed; the required ones must be there.
 * - `values <.env.production.local>`: the values pulled for the build have the right shape (the real
 *   Supabase project, a publishable key, SUPABASE_PROJECT_ENV=production...).
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Read by the app in production (src/**, BB-19 inventory). Anything else is rejected. */
export const PRODUCTION_ENV_ALLOWLIST = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PROJECT_ENV",
  "SUPABASE_PRODUCTION_PROJECT_REF",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "RATE_LIMIT_UPSTREAM_URL",
  "RATE_LIMIT_API_KEY",
  "RATE_LIMIT_TIMEOUT_MS",
  "PRIVACY_CONTACT_WHATSAPP",
  "PRIVACY_CONTACT_EMAIL",
  "MERCADO_PAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_WEBHOOK_SECRET"
]);

/** Without these the site cannot read the menu (src/server/supabase/config.ts). */
export const PRODUCTION_ENV_REQUIRED = Object.freeze(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PROJECT_ENV"]);

const WHY = {
  SUPABASE_SECRET_KEY: "la app no la lee (usa SUPABASE_SERVICE_ROLE_KEY)",
  SUPABASE_TEST_ADMIN_EMAIL: "credencial de test de CI",
  SUPABASE_TEST_ADMIN_PASSWORD: "credencial de test de CI",
  SUPABASE_TEST_MEMBERLESS_EMAIL: "credencial de test de CI",
  SUPABASE_TEST_MEMBERLESS_PASSWORD: "credencial de test de CI",
  SUPABASE_DEV_DB_URL: "conexión directa a la base, sólo para CI"
};

const targetsOf = (env) => (Array.isArray(env?.target) ? env.target : [env?.target]);

/**
 * @param {Array<{ envs?: unknown, pagination?: { next?: unknown } | null }>} pages every page, in order
 * @returns {string[]} findings (names only)
 */
export function checkProductionEnvNames(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return ["No se leyó ninguna respuesta de variables de Vercel."];
  const findings = [];
  const present = new Set();
  pages.forEach((page, index) => {
    if (!page || typeof page !== "object" || !Array.isArray(page.envs)) {
      findings.push(`La respuesta ${index + 1} de Vercel no trae la lista de variables.`);
      return;
    }
    for (const env of page.envs) {
      if (!targetsOf(env).includes("production")) continue;
      present.add(env.key);
      if (!PRODUCTION_ENV_ALLOWLIST.includes(env.key)) {
        findings.push(`${env.key} está cargada en Production y la app no la usa${WHY[env.key] ? ` (${WHY[env.key]})` : ""}; quitála de Vercel.`);
      }
    }
  });
  const next = pages.at(-1)?.pagination?.next;
  if (next !== undefined && next !== null) findings.push("La respuesta de variables de Vercel está incompleta (hay otra página sin leer).");
  for (const name of PRODUCTION_ENV_REQUIRED) {
    if (!present.has(name)) findings.push(`Falta ${name} en las variables de Production de Vercel.`);
  }
  return findings;
}

/** `KEY="value"` lines as written by `vercel pull`. */
export function parseDotenv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1).replace(/\\n/g, "\n");
    values[match[1]] = value;
  }
  return values;
}

/**
 * Same rules as src/server/supabase/config.ts for a production deployment, plus the project ref
 * check that the app only applies when SUPABASE_PRODUCTION_PROJECT_REF is set.
 * @param {Record<string, string>} values
 */
export function checkProductionEnvValues(values) {
  const findings = [];
  const url = values.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url)?.[1];
  if (!ref) findings.push("NEXT_PUBLIC_SUPABASE_URL no es https://<ref>.supabase.co.");
  const key = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!key) findings.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY está vacía.");
  else if (key.startsWith("sb_secret_")) findings.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY tiene una clave secreta: iría al navegador.");
  if (values.SUPABASE_PROJECT_ENV?.trim() !== "production") findings.push("SUPABASE_PROJECT_ENV tiene que ser production.");
  const productionRef = values.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  if (productionRef && ref && productionRef !== ref) findings.push("SUPABASE_PRODUCTION_PROJECT_REF no coincide con NEXT_PUBLIC_SUPABASE_URL.");
  for (const name of ["APP_URL", "NEXT_PUBLIC_SITE_URL"]) {
    const value = values[name]?.trim();
    if (value && !/^https:\/\/[^\s/]+/.test(value)) findings.push(`${name} tiene que ser una URL https.`);
  }
  return findings;
}

function report(findings, ok) {
  for (const finding of findings) console.log(`::error::${finding}`);
  if (!findings.length) console.log(ok);
  return findings.length ? 1 : 0;
}

export function main(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case "names":
      return report(
        checkProductionEnvNames(args.map((file) => JSON.parse(readFileSync(file, "utf8")))),
        "Variables de Production: sólo las que la app usa, con las obligatorias."
      );
    case "values":
      return report(checkProductionEnvValues(parseDotenv(readFileSync(args[0] ?? "", "utf8"))), "Valores de Production con el formato esperado.");
    default:
      console.log("::error::Uso: vercel-production-guard.mjs names <page1.json> [...] | values <.env.production.local>");
      return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
