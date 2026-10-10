import "server-only";

import { revalidatePath, updateTag } from "next/cache";
import type { Result } from "@/lib/result";
import type { AdminOutcome } from "@/server/admin/use-case";
import { CATALOG_CACHE_TAG } from "@/server/catalog";
import type { AdminFormState } from "./form-state";

/*
 * Runs an admin use case for a Server Action: builds its dependencies (session client), lets the
 * use case authorize and validate, and turns the outcome into form state. A successful write
 * expires the public catalog cache (store data, payment methods and promotions are part of it)
 * and the admin pages under `revalidate`.
 */
export async function performAdminAction<D, T>(
  dependencies: () => Promise<Result<D, unknown>>,
  operation: (deps: D, form: FormData) => Promise<AdminOutcome<T>>,
  form: FormData,
  revalidate: string
): Promise<{ state: AdminFormState; value?: T }> {
  const deps = await dependencies();
  if (!deps.ok) return { state: { status: "error", message: "No pudimos guardar los cambios. Intentá nuevamente." } };
  const outcome = await operation(deps.value, form);
  if (!outcome.ok) {
    return {
      state: {
        status: "error",
        message: outcome.message,
        ...(outcome.fieldErrors ? { fieldErrors: outcome.fieldErrors } : {}),
        ...(outcome.issues ? { issues: outcome.issues } : {})
      }
    };
  }
  updateTag(CATALOG_CACHE_TAG);
  revalidatePath(revalidate, "layout");
  return { state: { status: "success", message: outcome.message }, value: outcome.value };
}
