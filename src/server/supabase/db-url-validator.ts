// Validates Supabase database connection URLs, migration inputs, and trust boundaries
// without revealing passwords, tokens, or credentials in error messages or logs.

export const DEFAULT_DEV_PROJECT_REF = "zokkgocmcaqcujltfkjf";
export const ALLOWED_MIGRATION_BRANCHES = ["main", "feat/bb-05-option-engine"];

/**
 * Checks if a hostname matches the official Supabase pooler host pattern.
 * e.g. aws-0-sa-east-1.pooler.supabase.com, aws-0-us-east-1.pooler.supabase.com
 */
export function isOfficialPoolerHost(hostname: string | undefined): boolean {
  if (!hostname || typeof hostname !== "string") return false;
  return /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname.trim().toLowerCase());
}

export interface ValidateDbUrlOptions {
  url?: string | undefined;
  expectedProjectRef?: string | undefined;
  productionRef?: string | undefined;
}

export type ValidateDbUrlResult =
  | { ok: true; projectRef: string; host: string; port: string; mode: "direct" | "pooler" }
  | { ok: false; error: string };

/**
 * Validates a PostgreSQL connection URL against the authorized development project.
 * Guaranteed never to return or log raw passwords or credentials.
 * Enforces exact structural validation:
 * - Direct connection: host must be exactly 'db.<expectedRef>.supabase.co' with username 'postgres' or 'postgres.<expectedRef>'.
 * - Pooler connection: host must match official Supabase pooler host and username must be exactly 'postgres.<expectedRef>'.
 * Rejects arbitrary hosts, other project refs, spoofed subdomains, and production references.
 */
export function validateDbUrl(options: ValidateDbUrlOptions = {}): ValidateDbUrlResult {
  const rawUrl = options.url !== undefined ? options.url : process.env.SUPABASE_DEV_DB_URL;
  const expectedRef = (options.expectedProjectRef || DEFAULT_DEV_PROJECT_REF).trim();
  const prodRef = (
    options.productionRef !== undefined ? options.productionRef : process.env.SUPABASE_PRODUCTION_PROJECT_REF
  )?.trim();

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
export function validateMigrationInputs(
  options: ValidateMigrationInputsOptions = {}
): ValidateMigrationInputsResult {
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

export interface ValidateTrustBoundaryOptions {
  eventName?: string | undefined;
  ref?: string | undefined;
  sha?: string | undefined;
  headSha?: string | undefined;
  verifiedSha?: string | undefined;
  allowedBranches?: string[] | undefined;
  isCi?: boolean | undefined;
}

export type ValidateTrustBoundaryResult =
  | { ok: true; reason: string; sha?: string | undefined }
  | { ok: false; error: string };

/**
 * Validates trust boundary and authorization to execute against cloud database.
 * Enforces:
 * 1. Trusted main workflow: push events on branch main are authorized.
 * 2. Explicit verified SHA: matching verified commit SHA from maintainer dispatch or authorized variable.
 * 3. Rejects unauthorized PR events or unreviewed SHAs on allowed refs.
 */
export function validateTrustBoundary(
  options: ValidateTrustBoundaryOptions = {}
): ValidateTrustBoundaryResult {
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
  const normalizedBranch = rawNormalize(ref);

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

function rawNormalize(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").trim();
}
