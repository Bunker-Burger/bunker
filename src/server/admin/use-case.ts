import type { Result } from "@/lib/result";
import type { AdminAccessGate } from "@/server/catalog/admin-access";
import type { CatalogError, CatalogErrorCode } from "@/server/catalog/errors";

/*
 * Shared shape of every admin use case (catalog, store, promotions): confirm through the admin
 * gate (auth.getUser + an active admin_memberships row) that the session administers the store,
 * take the store id from that membership (never from the form), then run. Results carry a message
 * for the admin; error details only go to logs.
 */

export type FieldErrors = Record<string, string>;

export type AdminErrorCode =
  | CatalogErrorCode
  /** A unique value is taken, or the row is still referenced. */
  | "conflict"
  /** The database rejected the values (check constraint or business trigger). */
  | "rejected";

export interface AdminError {
  code: AdminErrorCode;
  message: string;
  cause?: unknown;
}

export type AdminResult<T> = Result<T, AdminError | CatalogError>;

export type AdminOutcome<T = undefined> =
  | { ok: true; message: string; value: T }
  | {
      ok: false;
      message: string;
      fieldErrors?: FieldErrors;
      issues?: string[];
      /**
       * A write reached the database and failed (or its answer was lost), so stored data may have
       * changed: caches built from it must be expired anyway. Absent when the use case stopped
       * before writing (validation, authorization, reads).
       */
      mayHaveWritten?: true;
    };

export type AdminFailure = Extract<AdminOutcome, { ok: false }>;

export interface AdminUseCaseDependencies {
  access: AdminAccessGate;
  storeSlug: string;
  log?: Pick<Console, "error">;
}

const GENERIC_FAILURE = "No pudimos guardar los cambios. Intentá nuevamente.";

const DEFAULT_MESSAGES: Record<string, string> = {
  unauthorized: "Tu sesión no tiene permisos de administración. Volvé a iniciar sesión.",
  not_found: "Ese elemento ya no existe. Recargá la página.",
  conflict: "Ya existe un elemento con ese slug.",
  rejected: "La base de datos rechazó los datos. Revisalos e intentá nuevamente."
};

export function adminUseCases(scope: string) {
  const success = <T>(message: string, value: T): AdminOutcome<T> => ({ ok: true, message, value });
  const invalid = (fieldErrors: FieldErrors): AdminOutcome<never> => ({ ok: false, message: "Revisá los datos marcados.", fieldErrors });

  function failure(
    deps: Pick<AdminUseCaseDependencies, "log">,
    operation: string,
    error: AdminError | CatalogError,
    messages: Partial<Record<string, string>> = {}
  ): AdminFailure {
    (deps.log ?? console).error(`[${scope}:${operation}] ${error.code}: ${error.message}`);
    return { ok: false, message: messages[error.code] ?? DEFAULT_MESSAGES[error.code] ?? GENERIC_FAILURE };
  }

  /** `failure` for a write that was sent: the caller must treat stored data as possibly changed. */
  function writeFailure(
    deps: Pick<AdminUseCaseDependencies, "log">,
    operation: string,
    error: AdminError | CatalogError,
    messages: Partial<Record<string, string>> = {}
  ): AdminFailure {
    return { ...failure(deps, operation, error, messages), mayHaveWritten: true };
  }

  /** Runs `operation` with the store id of the verified admin, or fails without touching anything. */
  async function asAdmin<T>(deps: AdminUseCaseDependencies, name: string, operation: (storeId: string) => Promise<AdminOutcome<T>>) {
    const membership = await deps.access.requireStoreAdmin(deps.storeSlug);
    if (!membership.ok) return failure(deps, name, membership.error);
    return operation(membership.value.storeId);
  }

  return { success, invalid, failure, writeFailure, asAdmin };
}
