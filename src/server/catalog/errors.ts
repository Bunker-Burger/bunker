import { err } from "@/lib/result";

export type CatalogErrorCode =
  /** The requested store does not exist or is not visible to the caller. */
  | "not_found"
  /** The caller has no session or lacks permission (RLS / JWT). */
  | "unauthorized"
  /** Supabase could not be reached or answered with a server error; retrying may help. */
  | "unavailable"
  /** Supabase answered, but a row broke the shape the domain relies on. */
  | "invalid_data"
  /** Credentials are missing or point at the wrong cloud project for this environment. */
  | "misconfigured";

export interface CatalogError {
  code: CatalogErrorCode;
  message: string;
  /** Original error for logs; never rendered to users. */
  cause?: unknown;
}

export function catalogError(code: CatalogErrorCode, message: string, cause?: unknown) {
  return err<CatalogError>(cause === undefined ? { code, message } : { code, message, cause });
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
  status?: number;
}

const UNAUTHORIZED_CODES = new Set(["42501", "PGRST301", "PGRST302", "PGRST303"]);

/** Maps a supabase-js / PostgREST failure (or a thrown network error) onto a controlled catalog error. */
export function fromSupabaseError(operation: string, error: unknown, status?: number) {
  const postgrest = (typeof error === "object" && error !== null ? error : {}) as PostgrestLikeError;
  const code = postgrest.code ?? "";
  const httpStatus = status ?? postgrest.status;
  const detail = postgrest.message ?? (error instanceof Error ? error.message : String(error));

  if (code === "PGRST116") return catalogError("not_found", `${operation}: no matching row`, error);
  if (UNAUTHORIZED_CODES.has(code) || httpStatus === 401 || httpStatus === 403) {
    return catalogError("unauthorized", `${operation}: permission denied`, error);
  }
  return catalogError("unavailable", `${operation} failed: ${detail}`, error);
}

/** Single place where catalog failures are logged; callers still receive the error result. */
export function reportCatalogError(scope: string, error: CatalogError, log: Pick<Console, "error"> = console) {
  log.error(`[catalog:${scope}] ${error.code}: ${error.message}`);
}
