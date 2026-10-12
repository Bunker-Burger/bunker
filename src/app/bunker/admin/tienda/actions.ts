"use server";

import {
  addShift,
  deleteShift,
  savePaymentMethod,
  saveStoreContact,
  setStoreStatus,
  storeAdminDependencies
} from "@/server/store-admin";
import { performAdminAction } from "../admin-action";
import type { AdminFormState } from "../form-state";
import { ADMIN_PANEL_PATH } from "../paths";

/* Authorization and validation live in the use cases (gate + RLS); nothing here trusts the form. */

export async function setStoreStatusAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, setStoreStatus, form, ADMIN_PANEL_PATH)).state;
}

export async function saveStoreContactAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, saveStoreContact, form, ADMIN_PANEL_PATH)).state;
}

export async function addShiftAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, addShift, form, ADMIN_PANEL_PATH)).state;
}

export async function deleteShiftAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, deleteShift, form, ADMIN_PANEL_PATH)).state;
}

export async function savePaymentMethodAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, savePaymentMethod, form, ADMIN_PANEL_PATH)).state;
}

/**
 * Drag and drop of the payment methods in the panel (issue #54): each one is saved with its new
 * position and the enabled state the panel showed; the use case validates every one.
 */
export async function reorderPaymentMethodsAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const methods = form.getAll("method").map(String);
  for (const [index, method] of methods.entries()) {
    const data = new FormData();
    data.set("method", method);
    data.set("sortOrder", String((index + 1) * 10));
    if (form.get(`enabled:${method}`) === "true") data.set("enabled", "true");
    const { state } = await performAdminAction(storeAdminDependencies, savePaymentMethod, data, ADMIN_PANEL_PATH);
    if (state.status !== "success") return state;
  }
  return { status: "success", message: "Orden de medios de pago guardado." };
}
