// Validates Supabase database connection URLs and migration inputs
// without revealing passwords, tokens, or credentials in error messages or logs.

export const DEFAULT_DEV_PROJECT_REF = "zokkgocmcaqcujltfkjf";
export const ALLOWED_MIGRATION_BRANCHES = ["main", "feat/bb-05-option-engine"];

export interface ValidateDbUrlOptions {
  url?: string | undefined;
  expectedProjectRef?: string | undefined;
  productionRef?: string | undefined;
}

export type ValidateDbUrlResult =
  | { ok: true; projectRef: string; host: string; port: string }
  | { ok: false; error: string };

/**
 * Validates a PostgreSQL connection URL against the authorized development project.
 * Guaranteed never to return or log raw passwords or credentials.
 */
export function validateDbUrl(options: ValidateDbUrlOptions = {}): ValidateDbUrlResult {
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
  let parsed: URL;
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

export interface ValidateMigrationInputsOptions {
  dryRun?: boolean | undefined;
  confirmProject?: string | undefined;
  expectedProjectRef?: string | undefined;
}

export type ValidateMigrationInputsResult =
  | { ok: true; mode: "dry-run" | "apply" }
  | { ok: false; error: string };

/**
 * Validates manual migration execution inputs (dry_run default and explicit confirmation).
 */
export function validateMigrationInputs(options: ValidateMigrationInputsOptions = {}): ValidateMigrationInputsResult {
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

export interface ValidateBranchOptions {
  branch?: string | undefined;
  allowedBranches?: string[] | undefined;
}

export type ValidateBranchResult =
  | { ok: true; branch: string }
  | { ok: false; error: string };

/**
 * Validates that the git ref / branch is allowed for migration workflows.
 */
export function validateBranch(options: ValidateBranchOptions = {}): ValidateBranchResult {
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
