"use server";

import { redirect } from "next/navigation";
import { deletePromotion, movePromotion, savePromotion, setPromotionActive, storeAdminDependencies } from "@/server/store-admin";
import { performAdminAction } from "../admin-action";
import type { AdminFormState } from "../form-state";
import { ADMIN_PROMOTIONS_PATH, promotionEditPath } from "../paths";

/* Authorization and validation live in the use cases (gate + RLS); nothing here trusts the form. */

/** A new promotion continues on its edit page; an edit stays on the form. */
export async function savePromotionAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const isNew = !form.get("promotionId");
  const { state, value } = await performAdminAction(storeAdminDependencies, savePromotion, form, ADMIN_PROMOTIONS_PATH);
  if (isNew && state.status === "success" && value) redirect(`${promotionEditPath(value.promotionId)}?creada=1`);
  return state;
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
