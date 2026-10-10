#!/usr/bin/env node
/*
 * Preflight of the Supabase project that the owner's credentials point at, run by
 * admin-auth-product-reviewed.yml from main's code (sparse checkout of THIS file) after the
 * environment approval and BEFORE the reviewed PR's code is checked out or receives any secret.
 * Its tests run THIS file as a child process (src/ci/preflight-supabase-dev.test.ts).
 *
 * `SUPABASE_PROJECT_ENV=development` is only a label; identity is proven here:
 *   - NEXT_PUBLIC_SUPABASE_URL is exactly https://<EXPECTED_PROJECT_REF>.supabase.co;
 *   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a publishable key (sb_publishable_…) or a legacy
 *     anon JWT whose `ref` claim is the expected project; secret / service_role keys fail;
 *   - the admin test credentials are present.
 * Dependency-free, no network. Prints no URL, key, e-mail or password; only the (public) ref.
 *
 * `--environment-protection <file>` mode (job `authorize`, before any secret exists in the run):
 * checks the JSON of GET /repos/:repo/environments/admin-auth-product. Secrets are released only
 * if the environment requires at least one human reviewer, administrators cannot bypass that rule,
 * and deployments are restricted by a branch policy (a workflow added by a PR cannot claim it).
 */

import { readFileSync } from "node:fs";

const PROJECT_REF = /^[a-z0-9]{20}$/;

class PreflightError extends Error {}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function checkUrl(raw, ref) {
  if (!raw) throw new PreflightError("Falta NEXT_PUBLIC_SUPABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new PreflightError("NEXT_PUBLIC_SUPABASE_URL no es una URL");
  }
  if (url.protocol !== "https:") throw new PreflightError("NEXT_PUBLIC_SUPABASE_URL debe usar https");
  if (url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
    throw new PreflightError("NEXT_PUBLIC_SUPABASE_URL no es la URL canónica de un proyecto");
  }
  if (url.hostname !== `${ref}.supabase.co`) {
    throw new PreflightError("NEXT_PUBLIC_SUPABASE_URL apunta a otro proyecto o dominio");
  }
}

function checkKey(key, ref) {
  if (!key) throw new PreflightError("Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (key.startsWith("sb_secret_")) throw new PreflightError("La clave es secreta, no publishable");
  if (key.startsWith("sb_publishable_")) {
    if (key.length <= "sb_publishable_".length) throw new PreflightError("Clave publishable vacía");
    return;
  }
  const claims = decodeJwtPayload(key);
  if (!claims) throw new PreflightError("La clave no es publishable ni un JWT anon");
  if (claims.role !== "anon") throw new PreflightError(`La clave JWT no es anon (role ${claims.role ?? "?"})`);
  if (claims.ref !== ref) throw new PreflightError("La clave JWT anon pertenece a otro proyecto");
}

/** Returns { ok, message }. Never includes secret values in `message`. */
export function preflight(env = process.env) {
  try {
    const ref = (env.EXPECTED_PROJECT_REF ?? "").trim();
    if (!PROJECT_REF.test(ref)) throw new PreflightError("EXPECTED_PROJECT_REF inválido");
    checkUrl((env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(), ref);
    checkKey((env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim(), ref);
    const email = (env.SUPABASE_TEST_ADMIN_EMAIL ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new PreflightError("Falta SUPABASE_TEST_ADMIN_EMAIL válido");
    if (!(env.SUPABASE_TEST_ADMIN_PASSWORD ?? "")) throw new PreflightError("Falta SUPABASE_TEST_ADMIN_PASSWORD");
    return { ok: true, message: `Preflight OK: proyecto development ${ref} verificado (URL canónica, clave publishable, credenciales presentes).` };
  } catch (error) {
    const reason = error instanceof PreflightError ? error.message : "error inesperado";
    return { ok: false, message: `::error::Preflight Supabase development: ${reason}` };
  }
}

/** Returns { ok, message } for the environment JSON returned by the GitHub API (or null). */
export function checkEnvironmentProtection(environment) {
  const fail = (reason) => ({ ok: false, message: `::error::Entorno admin-auth-product: ${reason}` });
  if (!environment || typeof environment !== "object") return fail("no existe o no se pudo leer");
  if (environment.name !== "admin-auth-product") return fail("no es el entorno esperado");
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const reviewers = rules
    .filter((rule) => rule?.type === "required_reviewers")
    .reduce((total, rule) => total + (Array.isArray(rule.reviewers) ? rule.reviewers.length : 0), 0);
  if (reviewers < 1) return fail("debe exigir required reviewers");
  if (environment.can_admins_bypass !== false) return fail("los administradores no deben poder saltear la aprobación");
  const policy = environment.deployment_branch_policy;
  if (!policy || (policy.protected_branches !== true && policy.custom_branch_policies !== true)) {
    return fail("debe restringir despliegues con una política de ramas");
  }
  return { ok: true, message: `Entorno admin-auth-product protegido: ${reviewers} reviewer(s), sin bypass de admins, con política de ramas.` };
}

function readEnvironmentFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/ci/preflight-supabase-dev.mjs")) {
  const result =
    process.argv[2] === "--environment-protection"
      ? checkEnvironmentProtection(process.argv[3] ? readEnvironmentFile(process.argv[3]) : null)
      : preflight();
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
