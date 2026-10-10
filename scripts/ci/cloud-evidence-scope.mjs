#!/usr/bin/env node
/*
 * Which cloud evidence a pull request needs before merge, decided only by the paths it changes
 * (docs/runbooks/cloud-evidence.md). Run by the informative `cloud-evidence-scope` job of ci.yml
 * with the PR's file list on stdin (one path per line); its tests run THIS file as a child
 * process. Dependency-free, no network, no secrets. It does not run anything in the cloud and
 * does not replace pgTAP or Auth runs: it only says which ones the protocol requires.
 */

import { appendFileSync, readFileSync } from "node:fs";

export const EVIDENCE = {
  migration: {
    label: "Migración: delta SQL revisado + dry-run del SHA; efecto real sólo con destino aislado",
    context: "sin status (run Cloud DB operation dry-run + comentario del mantenedor)",
    how: "revisar el SQL nuevo y correr Actions → Cloud DB — ejecución revisada (main), operation dry-run, desde main (docs/runbooks/cloud-evidence.md §Migraciones)"
  },
  pgtap: {
    label: "pgTAP cloud",
    context: "cloud/pgTAP-reviewed",
    how: "Actions → Cloud DB — ejecución revisada (main), operation pgTAP, desde main"
  },
  authConfig: {
    label: "Auth config (harness de main)",
    context: "cloud/admin-auth-reviewed",
    how: "Actions → Admin Auth — ejecución revisada (main), desde main"
  },
  authProduct: {
    label: "Auth producto (integración 2/2 + E2E 3/3)",
    context: "cloud/admin-auth-product-reviewed",
    how: "Actions → Admin Auth producto — ejecución revisada (main); requiere el entorno protegido admin-auth-product"
  }
};

/**
 * `before`: evidence on the exact PR HEAD before merge. `afterMerge`: trusted main-only
 * infrastructure; a PR cannot run its own version, so the affected workflow is run from main once
 * merged. `review`: maintainer review of the diff, no cloud run.
 */
export const RULES = [
  { pattern: /^supabase\/migrations\//, before: ["migration", "pgtap", "authConfig"], reason: "migraciones (esquema, RLS, grants)" },
  { pattern: /^supabase\/tests\/database\//, before: ["pgtap"], reason: "tests pgTAP" },
  { pattern: /^supabase\/seed\.sql$/, before: ["pgtap"], reason: "seed de datos" },
  { pattern: /^src\/server\/auth\//, before: ["authProduct"], reason: "sesión y login administrativos" },
  { pattern: /^src\/server\/catalog\/admin-access[^/]*\.ts$/, before: ["authProduct"], reason: "gate admin_memberships" },
  // loadAdminCatalog exige requireStoreAdmin y que la tienda leída sea la del admin.
  { pattern: /^src\/server\/catalog\/catalog-service\.ts$/, before: ["authProduct"], reason: "loadAdminCatalog: gate admin y tienda del admin" },
  // getAdminCatalog: único acceso al catálogo admin; arma cliente de sesión (RLS del usuario), scope admin y gate.
  { pattern: /^src\/server\/catalog\/index\.ts$/, before: ["authProduct"], reason: "getAdminCatalog: cliente de sesión, scope admin y gate" },
  // BB-12: escrituras del catálogo como el admin (gate + cliente de sesión + Storage con RLS).
  { pattern: /^src\/server\/catalog-admin\//, before: ["authProduct"], reason: "escrituras admin del catálogo: gate, sesión y Storage" },
  // BB-13: tienda, horarios, pagos y promociones como el admin, y el gate/escrituras compartidos.
  { pattern: /^src\/server\/(store-admin|admin)\//, before: ["authProduct"], reason: "escrituras admin de tienda y promociones, gate compartido" },
  { pattern: /^src\/server\/supabase\/(clients|config|update-session)\.ts$/, before: ["authProduct"], reason: "clientes Supabase y cookies SSR" },
  { pattern: /^src\/proxy\.ts$/, before: ["authProduct"], reason: "proxy de sesión" },
  { pattern: /^src\/app\/bunker\//, before: ["authProduct"], reason: "rutas administrativas /bunker" },
  { pattern: /^src\/app\/sw(-routes)?\.ts$/, before: ["authProduct"], reason: "caché del service worker (NetworkOnly admin)" },
  { pattern: /^(tests\/e2e\/admin-auth\.spec\.ts|playwright\.admin-auth\.config\.ts)$/, before: ["authProduct"], reason: "suite Auth producto" },
  { pattern: /^\.github\/workflows\/cloud-db-reviewed\.yml$/, afterMerge: ["pgtap"], reason: "workflow confiable de pgTAP" },
  { pattern: /^(\.github\/workflows\/admin-auth-reviewed\.yml|scripts\/check-admin-auth-cloud\.mjs)$/, afterMerge: ["authConfig"], reason: "harness confiable de Auth config" },
  { pattern: /^(\.github\/workflows\/admin-auth-product-reviewed\.yml|scripts\/ci\/preflight-supabase-dev\.mjs)$/, afterMerge: ["authProduct"], reason: "workflow confiable de Auth producto" },
  { pattern: /^(\.github\/workflows\/ci\.yml|scripts\/ci\/(verify-cloud-statuses|cloud-evidence-scope)\.mjs)$/, review: true, reason: "protocolo de evidencia" }
];

/** Classifies changed paths. Each path may match several rules; evidence ids are deduplicated. */
export function classify(paths) {
  const before = new Map();
  const afterMerge = new Map();
  const review = [];
  const add = (target, ids, path, reason) => {
    for (const id of ids ?? []) {
      if (!target.has(id)) target.set(id, []);
      target.get(id).push(`${path} (${reason})`);
    }
  };
  for (const path of paths) {
    for (const rule of RULES) {
      if (!rule.pattern.test(path)) continue;
      add(before, rule.before, path, rule.reason);
      add(afterMerge, rule.afterMerge, path, rule.reason);
      if (rule.review) review.push(`${path} (${rule.reason})`);
    }
  }
  const order = Object.keys(EVIDENCE);
  const sorted = (map) => order.filter((id) => map.has(id)).map((id) => ({ id, ...EVIDENCE[id], files: map.get(id) }));
  return { before: sorted(before), afterMerge: sorted(afterMerge), review };
}

/**
 * Shown whenever a PR changes supabase/migrations: what the available runs do NOT prove about the
 * new migration, so a pgTAP/Auth success is never read as validation of it.
 */
export const MIGRATION_WARNING = [
  "> **Atención — migraciones:** pgTAP y Auth config corren contra el esquema cloud **ya aplicado**; no aplican ni ejecutan la migración nueva, así que su success **no valida la migración**.",
  "> El dry-run sólo lista qué migraciones se aplicarían; no ejecuta su SQL.",
  "> Sin un destino de desarrollo aislado donde se haya aplicado deliberadamente, el **efecto de la migración queda NO verificado**: registrarlo así y mergear sólo con decisión explícita del mantenedor (bloquear o aceptar el riesgo)."
];

/** Markdown for the job summary; never contains secrets (only paths, SHA and PR number). */
export function report(result, { sha = "", pr = "" } = {}) {
  const head = sha ? `\`${sha}\`` : "(HEAD de la PR)";
  const lines = [`### Evidencia cloud requerida por alcance — PR #${pr || "?"} @ ${head}`, ""];
  if (result.before.length === 0 && result.afterMerge.length === 0 && result.review.length === 0) {
    lines.push("Sin cambios en Supabase, Auth, sesiones admin ni infraestructura cloud: no se requiere evidencia cloud.");
    return lines.join("\n");
  }
  if (result.before.some((item) => item.id === "migration")) {
    lines.push(...MIGRATION_WARNING, "");
  }
  if (result.before.length > 0) {
    lines.push("**Antes del merge, sobre este SHA exacto** (registrar en un comentario de la PR, ver docs/runbooks/cloud-evidence.md):", "");
    for (const item of result.before) {
      lines.push(`- **${item.label}** — \`${item.context}\` — ${item.how}`);
      for (const file of item.files) lines.push(`  - ${file}`);
    }
    lines.push("");
  }
  if (result.afterMerge.length > 0) {
    lines.push("**Infraestructura confiable de main** (revisión del mantenedor; se valida con el primer run desde main posterior al merge, sobre la próxima PR que necesite esa evidencia, y se registra en esta PR):", "");
    for (const item of result.afterMerge) {
      lines.push(`- **${item.label}** — ${item.how}`);
      for (const file of item.files) lines.push(`  - ${file}`);
    }
    lines.push("");
  }
  if (result.review.length > 0) {
    lines.push("**Revisión del mantenedor, sin corrida cloud:**", "");
    for (const file of result.review) lines.push(`- ${file}`);
    lines.push("");
  }
  lines.push("Este job es informativo: no ejecuta nada en la nube ni reemplaza pgTAP o los tests Auth.");
  return lines.join("\n");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/ci/cloud-evidence-scope.mjs")) {
  const paths = readFileSync(0, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    console.log("::error::Lista de archivos de la PR vacía o ilegible: no se puede determinar el alcance");
    process.exit(1);
  }
  const result = classify(paths);
  const markdown = report(result, { sha: process.env.HEAD_SHA ?? "", pr: process.env.PR_NUMBER ?? "" });
  console.log(markdown);
  for (const item of result.before) console.log(`::notice title=Evidencia cloud requerida::${item.label} (${item.context}) antes del merge`);
  if (result.before.some((item) => item.id === "migration")) {
    console.log("::warning title=Migración sin validación automática::pgTAP/Auth config prueban el esquema ya aplicado y el dry-run no ejecuta SQL: el efecto de la migración no queda verificado sin destino aislado; requiere decisión del mantenedor");
  }
  for (const item of result.afterMerge) console.log(`::notice title=Infra cloud modificada::${item.label}: validar con el primer run desde main posterior al merge`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}
