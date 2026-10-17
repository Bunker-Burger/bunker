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

/**
 * A new product continues on its edit page (publication, options); an edit stays on the form.
 * The photo travels with the form (issue #54) and is uploaded, recentred or removed once the
 * product itself is saved.
 */
export async function saveProductAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const isNew = !form.get("productId");
  // Options first: publishing the product checks the options it offers.
  const optionProblems = await saveOptionEdits(form);
  const { state, value } = await perform(saveProduct, form);
  if (state.status !== "success" || !value) {
    return optionProblems.length > 0 && state.status === "error"
      ? { ...state, message: `${state.message} Opciones sin guardar: ${optionProblems.join(" ")}` }
      : state;
  }
  const photo = await savePhoto(value.productId, form);
  const withOptions = (message: string) => (optionProblems.length > 0 ? `${message} Opciones sin guardar: ${optionProblems.join(" ")}` : message);
  if (isNew) redirect(`${productEditPath(value.productId)}?creado=1${photo?.status === "error" ? "&foto=0" : ""}`);
  if (photo?.status === "error") {
    return { ...photo, message: withOptions(`Producto guardado, pero la foto no: ${photo.fieldErrors?.image ?? photo.message}`) };
  }
  const message = withOptions(photo ? `${state.message} ${photo.message}` : (state.message ?? "Guardado."));
  return optionProblems.length > 0 ? { status: "error", message } : { status: "success", message };
}

/**
 * The extras and types shown in the product form are saved with it (issue #54): the rows the admin
 * touched (`touchedOption` = "groupId|optionId") and a new option typed under a group
 * (`newOptionGroup` + `newOptionName:<groupId>`). Returns what could not be saved.
 */
async function saveOptionEdits(form: FormData): Promise<string[]> {
  const problems: string[] = [];
  const run = async (data: FormData, name: string) => {
    const { state } = await perform(saveOption, data);
    if (state.status === "error") problems.push(`${name}: ${[...Object.values(state.fieldErrors ?? {}), state.message].filter(Boolean)[0]}`);
  };
  for (const entry of form.getAll("touchedOption").map(String)) {
    const [groupId, optionId] = entry.split("|");
    if (!groupId || !optionId) continue;
    const data = new FormData();
    data.set("groupId", groupId);
    data.set("optionId", optionId);
    data.set("name", String(form.get(`optionName:${optionId}`) ?? ""));
    data.set("price", String(form.get(`optionPrice:${optionId}`) ?? ""));
    if (form.has(`optionAvailable:${optionId}`)) data.set("available", "true");
    await run(data, String(form.get(`optionName:${optionId}`) ?? "opción"));
  }
  for (const groupId of form.getAll("newOptionGroup").map(String)) {
    const name = String(form.get(`newOptionName:${groupId}`) ?? "").trim();
    if (name === "") continue;
    const data = new FormData();
    data.set("groupId", groupId);
    data.set("name", name);
    data.set("price", String(form.get(`newOptionPrice:${groupId}`) ?? ""));
    data.set("available", "true");
    await run(data, name);
  }
  return problems;
}

async function savePhoto(productId: string, form: FormData): Promise<AdminFormState | null> {
  const file = form.get("image");
  const hasFile = typeof file === "object" && file !== null && file.size > 0;
  const data = new FormData();
  data.set("productId", productId);
  if (form.get("removeImage") === "true" && !hasFile) return (await perform(deleteProductImage, data)).state;
  if (!hasFile && form.get("photoMoved") !== "true") return null;
  if (hasFile) data.set("image", file);
  for (const field of ["focalX", "focalY"]) data.set(field, String(form.get(field) ?? "50"));
  return (await perform(saveProductImage, data)).state;
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
