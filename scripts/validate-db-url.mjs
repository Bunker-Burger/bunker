#!/usr/bin/env node
// Validates Supabase database connection URLs, migration inputs, and trust boundaries
// without revealing passwords, tokens, or credentials in error messages or logs.

import { fileURLToPath } from "node:url";

export const DEFAULT_DEV_PROJECT_REF = "zokkgocmcaqcujltfkjf";
export const ALLOWED_MIGRATION_BRANCHES = ["main", "feat/bb-05-option-engine"];

/**
 * Checks if a hostname matches the official Supabase pooler host pattern.
 * e.g. aws-0-sa-east-1.pooler.supabase.com, aws-0-us-east-1.pooler.supabase.com
 */
export function isOfficialPoolerHost(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  return /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname.trim().toLowerCase());
}

/**
 * Validates a PostgreSQL connection URL against the authorized development project.
 * Guaranteed never to return or log raw passwords or credentials.
 * Enforces exact structural validation:
 * - Direct connection: host must be exactly 'db.<expectedRef>.supabase.co' with username 'postgres' or 'postgres.<expectedRef>'.
 * - Pooler connection: host must match official Supabase pooler host and username must be exactly 'postgres.<expectedRef>'.
 * Rejects arbitrary hosts, other project refs, spoofed subdomains, and production references.
 */
export function validateDbUrl(options = {}) {
  const rawUrl = options.url !== undefined ? options.url : process.env.SUPABASE_DEV_DB_URL;
  const expectedRef = (options.expectedProjectRef || DEFAULT_DEV_PROJECT_REF).trim();
  const prodRef = (options.productionRef !== undefined ? options.productionRef : process.env.SUPABASE_PRODUCTION_PROJECT_REF)?.trim();

  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return {
      ok: false,
      error: "SUPABASE_DEV_DB_URL no está configurado o está vacío.",
    };
  }

  const trimmed = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: "SUPABASE_DEV_DB_URL no tiene un formato de URL válido.",
    };
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return {
      ok: false,
      error: "SUPABASE_DEV_DB_URL debe utilizar el protocolo postgresql: o postgres:.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username);
  const expected = expectedRef.toLowerCase();
  const prod = prodRef ? prodRef.toLowerCase() : "";

  // Reject production references
  if (prod && prod.length > 0) {
    const isDirectProd = hostname === `db.${prod}.supabase.co`;
    const isPoolerProd = isOfficialPoolerHost(hostname) && username === `postgres.${prod}`;
    if (isDirectProd || isPoolerProd || hostname.includes(prod) || username.includes(prod) || expected === prod) {
      return {
        ok: false,
        error: "SUPABASE_DEV_DB_URL apunta al proyecto de producción no permitido.",
      };
    }
  }

  // Exact structural check:
  // 1. Direct connection: host is strictly 'db.<expected>.supabase.co'
  const isDirectDev =
    hostname === `db.${expected}.supabase.co` &&
    (username === "postgres" || username === `postgres.${expected}`);

  // 2. Pooler connection: host is strictly an official Supabase pooler AND username is strictly 'postgres.<expected>'
  const isPoolerDev =
    isOfficialPoolerHost(hostname) &&
    username === `postgres.${expected}`;

  if (!isDirectDev && !isPoolerDev) {
    return {
      ok: false,
      error: `SUPABASE_DEV_DB_URL no coincide con el identificador del proyecto de desarrollo autorizado (${expectedRef}).`,
    };
  }

  return {
    ok: true,
    projectRef: expectedRef,
    host: parsed.hostname,
    port: parsed.port || (isPoolerDev ? "6543" : "5432"),
    mode: isPoolerDev ? "pooler" : "direct",
  };
}

/**
 * Validates manual migration execution inputs (dry_run default and explicit confirmation).
 */
export function validateMigrationInputs(options = {}) {
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : true;
  const confirmProject = (options.confirmProject || "").trim();
  const expectedRef = (options.expectedProjectRef || DEFAULT_DEV_PROJECT_REF).trim();

  if (dryRun) {
    return { ok: true, mode: "dry-run" };
  }

  if (confirmProject !== expectedRef) {
    return {
      ok: false,
      error: `Para aplicar migraciones en desarrollo (dry_run=false), se requiere confirmación expresa indicando el ID del proyecto ('${expectedRef}').`,
    };
  }

  return { ok: true, mode: "apply" };
}

/**
 * Validates that the git ref / branch is allowed for migration workflows.
 */
export function validateBranch(options = {}) {
  const rawBranch = options.branch || "";
  const normalized = rawBranch.replace(/^refs\/heads\//, "").trim();
  const allowed = options.allowedBranches || ALLOWED_MIGRATION_BRANCHES;

  if (!normalized || !allowed.includes(normalized)) {
    return {
      ok: false,
      error: `La rama '${normalized || "desconocida"}' no está autorizada para ejecutar migraciones directas. Ramas permitidas: ${allowed.join(", ")}.`,
    };
  }

  return { ok: true, branch: normalized };
}

/**
 * Validates trust boundary and authorization to execute against cloud database.
 * Enforces:
 * 1. Trusted main workflow: push events on branch main are authorized.
 * 2. Explicit verified SHA: matching verified commit SHA from maintainer dispatch or authorized variable.
 * 3. Rejects unauthorized PR events or unreviewed SHAs on allowed refs.
 */
export function validateTrustBoundary(options = {}) {
  const isCi = options.isCi !== undefined ? options.isCi : process.env.GITHUB_ACTIONS === "true";
  if (!isCi) {
    return { ok: true, reason: "local-environment" };
  }

  const eventName = options.eventName !== undefined ? options.eventName : (process.env.GITHUB_EVENT_NAME || "");
  const ref = options.ref !== undefined ? options.ref : (process.env.GITHUB_REF || "");
  const sha = (options.sha !== undefined ? options.sha : (process.env.GITHUB_SHA || "")).trim();
  const headSha = (options.headSha !== undefined ? options.headSha : (process.env.GITHUB_HEAD_SHA || "")).trim();
  const verifiedSha = (
    options.verifiedSha !== undefined
      ? options.verifiedSha
      : (process.env.VERIFIED_SHA || process.env.INPUT_VERIFIED_SHA || "")
  ).trim();
  const allowedBranches = options.allowedBranches || ALLOWED_MIGRATION_BRANCHES;
  const normalizedBranch = ref.replace(/^refs\/heads\//, "").trim();

  // 1. Trusted main workflow: push on main
  if (eventName === "push" && normalizedBranch === "main") {
    return { ok: true, reason: "trusted-main", sha: sha || headSha };
  }

  // 2. Explicit verified SHA check (manual maintainer dispatch or repository variable)
  const candidateShas = [headSha, sha].filter((s) => s.length >= 7).map((s) => s.toLowerCase());
  if (verifiedSha.length >= 7 && candidateShas.length > 0) {
    const normVerified = verifiedSha.toLowerCase();
    const matchingSha = candidateShas.find(
      (cand) => cand.startsWith(normVerified) || normVerified.startsWith(cand)
    );
    if (matchingSha) {
      if (normalizedBranch && !allowedBranches.includes(normalizedBranch)) {
        return {
          ok: false,
          error: `Ejecución cloud bloqueada: la rama '${normalizedBranch}' no está en la lista de ramas autorizadas (${allowedBranches.join(", ")}).`,
        };
      }
      return { ok: true, reason: "verified-sha", sha: matchingSha };
    }
    return {
      ok: false,
      error: `Ejecución cloud bloqueada: el commit '${candidateShas[0]}' no coincide con el SHA autorizado ('${verifiedSha}').`,
    };
  }

  // 3. Untrusted event or unverified SHA
  return {
    ok: false,
    error: `Ejecución cloud bloqueada: el commit '${(candidateShas[0] || sha).slice(0, 7) || "desconocido"}' en '${ref || "desconocido"}' no cuenta con autorización verificada de un mantenedor para acceder a credenciales cloud.`,
  };
}

// CLI Execution entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isMigrationMode = process.argv.includes("--migration");
  const isTrustCheckMode = process.argv.includes("--trust-check") || process.env.GITHUB_ACTIONS === "true";

  // Parse inputs safely from environment variables (preferred for workflow injection protection)
  // or command line arguments
  const envDryRun = process.env.INPUT_DRY_RUN;
  const dryRunArg = process.argv.find((a) => a.startsWith("--dry-run="));
  let dryRun = true;
  if (envDryRun !== undefined) {
    dryRun = envDryRun !== "false";
  } else if (dryRunArg) {
    dryRun = dryRunArg.split("=")[1] !== "false";
  }

  const envConfirm = process.env.INPUT_CONFIRM_PROJECT;
  const confirmArg = process.argv.find((a) => a.startsWith("--confirm="));
  const confirmProject =
    envConfirm !== undefined ? envConfirm : confirmArg ? confirmArg.slice("--confirm=".length) : "";

  const envBranch = process.env.INPUT_BRANCH || process.env.GITHUB_REF;
  const branchArg = process.argv.find((a) => a.startsWith("--branch="));
  const branch = envBranch !== undefined ? envBranch : branchArg ? branchArg.slice("--branch=".length) : "";

  if (isMigrationMode) {
    // 1. Branch check
    const branchResult = validateBranch({ branch });
    if (!branchResult.ok) {
      console.error(`::error::[db-validate] ${branchResult.error}`);
      process.exit(1);
    }

    // 2. Migration inputs check (dry-run & confirmation)
    const inputResult = validateMigrationInputs({ dryRun, confirmProject });
    if (!inputResult.ok) {
      console.error(`::error::[db-validate] ${inputResult.error}`);
      process.exit(1);
    }

    // 3. Trust boundary check
    if (isTrustCheckMode) {
      const trustResult = validateTrustBoundary();
      if (!trustResult.ok) {
        console.error(`::error::[trust-boundary] ${trustResult.error}`);
        process.exit(1);
      }
    }

    // 4. DB URL check
    const urlResult = validateDbUrl();
    if (!urlResult.ok) {
      console.error(`::error::[db-validate] ${urlResult.error}`);
      process.exit(1);
    }

    console.log(
      `[db-validate] Validación exitosa para rama '${branchResult.branch}'. Modo: ${inputResult.mode}. Proyecto: ${urlResult.projectRef} (${urlResult.mode}).`
    );
    process.exit(0);
  } else {
    // Basic DB URL validation mode (CI database job or local validation)
    if (isTrustCheckMode) {
      const trustResult = validateTrustBoundary();
      if (!trustResult.ok) {
        console.error(`::error::[trust-boundary] ${trustResult.error}`);
        process.exit(1);
      }
    }

    const urlResult = validateDbUrl();
    if (!urlResult.ok) {
      console.error(`::error::[db-validate] ${urlResult.error}`);
      process.exit(1);
    }

    console.log(
      `[db-validate] Conexión de base de datos validada exitosamente para el proyecto development '${urlResult.projectRef}' (${urlResult.mode}).`
    );
    process.exit(0);
  }
}
