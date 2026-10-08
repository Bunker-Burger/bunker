#!/usr/bin/env node
// Validates Supabase database connection URLs and migration inputs
// without revealing passwords, tokens, or credentials in error messages or logs.

import { fileURLToPath } from "node:url";

export const DEFAULT_DEV_PROJECT_REF = "zokkgocmcaqcujltfkjf";
export const ALLOWED_MIGRATION_BRANCHES = ["main", "feat/bb-05-option-engine"];

/**
 * Validates a PostgreSQL connection URL against the authorized development project.
 * Guaranteed never to return or log raw passwords or credentials.
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

  // Reject production references
  if (prodRef && prodRef.length > 0) {
    if (parsed.hostname.includes(prodRef) || parsed.username.includes(prodRef)) {
      return {
        ok: false,
        error: "SUPABASE_DEV_DB_URL apunta al proyecto de producción no permitido.",
      };
    }
  }

  // Validate that hostname or username matches the expected development project ref
  const matchesDev = parsed.hostname.includes(expectedRef) || parsed.username.includes(expectedRef);
  if (!matchesDev) {
    return {
      ok: false,
      error: `SUPABASE_DEV_DB_URL no coincide con el identificador del proyecto de desarrollo autorizado (${expectedRef}).`,
    };
  }

  return {
    ok: true,
    projectRef: expectedRef,
    host: parsed.hostname,
    port: parsed.port || "5432",
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

// CLI Execution entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isMigrationMode = process.argv.includes("--migration");

  if (isMigrationMode) {
    const dryRunArg = process.argv.find((a) => a.startsWith("--dry-run="));
    const dryRun = dryRunArg ? dryRunArg.split("=")[1] !== "false" : true;

    const confirmArg = process.argv.find((a) => a.startsWith("--confirm="));
    const confirmProject = confirmArg ? confirmArg.split("=")[1] : "";

    const branchArg = process.argv.find((a) => a.startsWith("--branch="));
    const branch = branchArg ? branchArg.split("=")[1] : process.env.GITHUB_REF || "";

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

    // 3. DB URL check
    const urlResult = validateDbUrl();
    if (!urlResult.ok) {
      console.error(`::error::[db-validate] ${urlResult.error}`);
      process.exit(1);
    }

    console.log(
      `[db-validate] Validación exitosa para rama '${branchResult.branch}'. Modo: ${inputResult.mode}. Proyecto: ${urlResult.projectRef}.`
    );
    process.exit(0);
  } else {
    // Basic DB URL validation mode
    const urlResult = validateDbUrl();
    if (!urlResult.ok) {
      console.error(`::error::[db-validate] ${urlResult.error}`);
      process.exit(1);
    }
    console.log(
      `[db-validate] Conexión de base de datos validada exitosamente para el proyecto development '${urlResult.projectRef}'.`
    );
    process.exit(0);
  }
}
