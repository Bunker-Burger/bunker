"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { CATALOG_CACHE_TAG } from "@/server/catalog";
import {
  catalogAdminDependencies,
  createCategory,
  deleteCategory,
  deleteProduct,
  deleteProductImage,
  moveCategory,
  moveProduct,
  saveProduct,
  reorderCategories,
  reorderOptions,
  reorderProducts,
  saveOption,
  saveProductImage,
  updateCategory,
  type AdminOutcome,
  type CatalogAdminDependencies
} from "@/server/catalog-admin";
import { ADMIN_CATALOG_PATH, productEditPath, type AdminFormState } from "./form-state";

/*
 * Every action authorizes inside the use case (auth.getUser + active admin_memberships) and the
 * database re-checks with RLS; nothing here trusts the form for the store or the user. A
 * successful write expires the public catalog cache so the menu shows it on the next request.
 */

type UseCase<T> = (deps: CatalogAdminDependencies, form: FormData) => Promise<AdminOutcome<T>>;

async function perform<T>(operation: UseCase<T>, form: FormData): Promise<{ state: AdminFormState; value?: T }> {
  const deps = await catalogAdminDependencies();
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
  revalidatePath(ADMIN_CATALOG_PATH, "layout");
  revalidatePath("/bunker/admin");
  return { state: { status: "success", message: outcome.message }, value: outcome.value };
}

export async function createCategoryAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(createCategory, form)).state;
}

export async function updateCategoryAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(updateCategory, form)).state;
}

export async function deleteCategoryAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(deleteCategory, form)).state;
}

export async function moveCategoryAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(moveCategory, form)).state;
}

export async function moveProductAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(moveProduct, form)).state;
}

export async function saveProductImageAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(saveProductImage, form)).state;
}

export async function deleteProductImageAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(deleteProductImage, form)).state;
}

/** A new product continues on its edit page (photo, publication); an edit stays on the form. */
export async function saveProductAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const isNew = !form.get("productId");
  const { state, value } = await perform(saveProduct, form);
  if (isNew && state.status === "success" && value) redirect(`${productEditPath(value.productId)}?creado=1`);
  return state;
}

/** After deleting, the product page no longer exists: back to the catalog tab. */
export async function deleteProductAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const { state } = await perform(deleteProduct, form);
  if (state.status === "success" && form.get("from") === "edit") {
    // The catalog lives in the control panel (issue #54).
    redirect("/bunker/admin");
  }
  return state;
}

/** Name, extra price and availability of an option, or a new option in a group (issue #54). */
export async function saveOptionAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(saveOption, form)).state;
}

/** New order of a group's options, dragged in the product form (issue #54). */
export async function reorderOptionsAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(reorderOptions, form)).state;
}

/** New order of the menu's sections, dragged in the panel (issue #54). */
export async function reorderCategoriesAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(reorderCategories, form)).state;
}

/** New order of one category's products, dragged in the panel (issue #54). */
export async function reorderProductsAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await perform(reorderProducts, form)).state;
}
