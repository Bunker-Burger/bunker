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
 * `--environment-protection` mode (job `authorize`, before any secret exists in the run): reads
 * GET /repos/:repo/environments/admin-auth-product and its deployment branch policies with the
 * run's read-only token. Secrets are released only if the EFFECTIVE policy admits nothing but
 * `main`: at least one required reviewer, no administrator bypass, and custom deployment branch
 * policies consisting of exactly one branch pattern, `main`. "Protected branches only" is refused:
 * it admits every protected branch, and with no protected branches GitHub admits all of them.
 * Any API error, missing field, wildcard, tag or incomplete pagination fails closed.
 */


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

const ENVIRONMENT = "admin-auth-product";

class ProtectionError extends Error {}

function githubApi(env, fetchImpl) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new ProtectionError("GITHUB_REPOSITORY inválido");
  const apiUrl = (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "";
  return async (path) => {
    let response;
    try {
      response = await fetchImpl(`${apiUrl}/repos/${repository}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        redirect: "error"
      });
    } catch {
      throw new ProtectionError(`no se pudo consultar ${path}`);
    }
    if (!response.ok) throw new ProtectionError(`GitHub API ${path} respondió HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new ProtectionError(`respuesta inválida de ${path}`);
    }
  };
}

/** Every deployment branch policy of the environment; fails unless the pages add up to total_count. */
async function deploymentBranchPolicies(api) {
  const policies = [];
  let total = null;
  for (let page = 1; page <= 10; page++) {
    const body = await api(`/environments/${ENVIRONMENT}/deployment-branch-policies?per_page=100&page=${page}`);
    if (!Number.isInteger(body?.total_count) || !Array.isArray(body?.branch_policies)) {
      throw new ProtectionError("respuesta de deployment-branch-policies inválida");
    }
    total = body.total_count;
    policies.push(...body.branch_policies);
    if (policies.length >= total || body.branch_policies.length === 0) break;
  }
  if (policies.length !== total) throw new ProtectionError("paginación de políticas de ramas incompleta");
  return policies;
}

/**
 * Returns { ok, message }: whether `admin-auth-product` releases its secrets only to `main`, with a
 * required human reviewer and no administrator bypass.
 */
export async function checkEnvironmentProtection(env = process.env, fetchImpl = globalThis.fetch) {
  try {
    const api = githubApi(env, fetchImpl);
    const environment = await api(`/environments/${ENVIRONMENT}`);
    if (environment?.name !== ENVIRONMENT) throw new ProtectionError("no es el entorno esperado");

    const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
    const reviewers = rules
      .filter((rule) => rule?.type === "required_reviewers")
      .reduce((total, rule) => total + (Array.isArray(rule.reviewers) ? rule.reviewers.length : 0), 0);
    if (reviewers < 1) throw new ProtectionError("debe exigir required reviewers");
    if (environment.can_admins_bypass !== false) throw new ProtectionError("los administradores no deben poder saltear la aprobación");

    const policy = environment.deployment_branch_policy;
    if (!policy) throw new ProtectionError("sin política de ramas: cualquier rama, incluida la de una PR, podría desplegar");
    if (policy.protected_branches === true) {
      throw new ProtectionError(
        "\"Protected branches only\" admite cualquier rama protegida (y todas si no hay ninguna); usar ramas seleccionadas con sólo main"
      );
    }
    if (policy.custom_branch_policies !== true) throw new ProtectionError("debe usar ramas seleccionadas con sólo main");

    const policies = await deploymentBranchPolicies(api);
    if (policies.length !== 1) {
      throw new ProtectionError(`debe tener exactamente una política de ramas (main); tiene ${policies.length}`);
    }
    const [only] = policies;
    if (only?.name !== "main" || (only.type ?? "branch") !== "branch") {
      throw new ProtectionError("la única política de ramas debe ser la rama main exacta, sin comodines ni tags");
    }
    return { ok: true, message: `Entorno ${ENVIRONMENT} protegido: ${reviewers} reviewer(s), sin bypass de admins, despliegue sólo desde main.` };
  } catch (error) {
    const reason = error instanceof ProtectionError ? error.message : "error inesperado";
    return { ok: false, message: `::error::Entorno ${ENVIRONMENT}: ${reason}` };
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/ci/preflight-supabase-dev.mjs")) {
  const result = process.argv[2] === "--environment-protection" ? await checkEnvironmentProtection() : preflight();
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
