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
import { ADMIN_STORE_PATH } from "../paths";

/* Authorization and validation live in the use cases (gate + RLS); nothing here trusts the form. */

export async function setStoreStatusAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, setStoreStatus, form, ADMIN_STORE_PATH)).state;
}

export async function saveStoreContactAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, saveStoreContact, form, ADMIN_STORE_PATH)).state;
}

export async function addShiftAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, addShift, form, ADMIN_STORE_PATH)).state;
}

export async function deleteShiftAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, deleteShift, form, ADMIN_STORE_PATH)).state;
}

export async function savePaymentMethodAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  return (await performAdminAction(storeAdminDependencies, savePaymentMethod, form, ADMIN_STORE_PATH)).state;
}
