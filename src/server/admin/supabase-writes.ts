import { err, ok, type Result } from "@/lib/result";
import { catalogError, fromSupabaseError } from "@/server/catalog/errors";
import type { QueryResponse } from "@/server/catalog/supabase-catalog-repository";
import type { AdminError, AdminResult } from "./use-case";

/*
 * Admin writes go through the signed-in admin's session client: no service role. RLS decides on
 * every statement; updates and deletes ask for the affected ids back, so a row RLS hides (or from
 * another store) is reported as `not_found` instead of a silent no-op.
 */

/** Database errors that mean "the values are wrong", not "try again". */
const REJECTED_CODES = new Set(["23514", "23502", "22P02", "22023", "22003", "BB003", "BB012", "BB013"]);

export function fromWriteError(operation: string, error: unknown, status?: number): Result<never, AdminError> {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "23505") return err({ code: "conflict", message: `${operation}: duplicate value`, cause: error });
  if (code === "23503") return err({ code: "conflict", message: `${operation}: still referenced`, cause: error });
  // Raised by the admin RPCs when the row is not in the caller's store.
  if (code === "P0002") return err({ code: "not_found", message: `${operation}: no row in this store`, cause: error });
  if (REJECTED_CODES.has(code)) return err({ code: "rejected", message: `${operation}: rejected by the database (${code})`, cause: error });
  return fromSupabaseError(operation, error, status);
}

export async function write(operation: string, query: PromiseLike<QueryResponse>): Promise<AdminResult<unknown>> {
  try {
    const { data, error, status } = await query;
    return error ? fromWriteError(operation, error, status) : ok(data);
  } catch (thrown) {
    return fromSupabaseError(operation, thrown);
  }
}

/** Update/delete with `.select(...)`: zero rows means RLS or the store filter excluded it. */
export async function writeOne(operation: string, query: PromiseLike<QueryResponse>): Promise<AdminResult<void>> {
  const result = await write(operation, query);
  if (!result.ok) return result;
  return Array.isArray(result.value) && result.value.length > 0
    ? ok(undefined)
    : catalogError("not_found", `${operation}: no row in this store`);
}
