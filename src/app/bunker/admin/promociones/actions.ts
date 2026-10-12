"use server";

import { redirect } from "next/navigation";
import { catalogAdminDependencies, deletePromotionImage, savePromotionImage } from "@/server/catalog-admin";
import { deletePromotion, movePromotion, savePromotion, setPromotionActive, storeAdminDependencies } from "@/server/store-admin";
import { performAdminAction } from "../admin-action";
import type { AdminFormState } from "../form-state";
import { ADMIN_PROMOTIONS_PATH, promotionEditPath } from "../paths";

/* Authorization and validation live in the use cases (gate + RLS); nothing here trusts the form. */

/**
 * A new promotion continues on its edit page; an edit stays on the form. The banner photo travels
 * with the form (issue #54) and is uploaded, or removed, once the promotion itself is saved.
 */
export async function savePromotionAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const isNew = !form.get("promotionId");
  const { state, value } = await performAdminAction(storeAdminDependencies, savePromotion, form, ADMIN_PROMOTIONS_PATH);
  if (state.status !== "success" || !value) return state;
  const photo = await savePhoto(value.promotionId, form);
  if (isNew) redirect(`${promotionEditPath(value.promotionId)}?creada=1${photo?.status === "error" ? "&foto=0" : ""}`);
  if (photo?.status === "error") {
    return { ...photo, message: `Promoción guardada, pero la foto no: ${photo.fieldErrors?.image ?? photo.message}` };
  }
  return photo ? { status: "success", message: `${state.message} ${photo.message}` } : state;
}

async function savePhoto(promotionId: string, form: FormData): Promise<AdminFormState | null> {
  const file = form.get("image");
  const hasFile = typeof file === "object" && file !== null && file.size > 0;
  const data = new FormData();
  data.set("promotionId", promotionId);
  if (form.get("removeImage") === "true" && !hasFile) {
    return (await performAdminAction(catalogAdminDependencies, deletePromotionImage, data, ADMIN_PROMOTIONS_PATH)).state;
  }
  if (!hasFile && form.get("photoMoved") !== "true") return null;
  if (hasFile) data.set("image", file);
  for (const field of ["focalX", "focalY"]) data.set(field, String(form.get(field) ?? "50"));
  return (await performAdminAction(catalogAdminDependencies, savePromotionImage, data, ADMIN_PROMOTIONS_PATH)).state;
}

export async function setPromotionActiveAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, setPromotionActive, form, ADMIN_PROMOTIONS_PATH)).state;
}

export async function movePromotionAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, movePromotion, form, ADMIN_PROMOTIONS_PATH)).state;
}

/** Deleting from the edit page goes back to the list (the page no longer exists). */
export async function deletePromotionAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const { state } = await performAdminAction(storeAdminDependencies, deletePromotion, form, ADMIN_PROMOTIONS_PATH);
  if (state.status === "success" && form.get("from") === "edit") redirect(ADMIN_PROMOTIONS_PATH);
  return state;
}

