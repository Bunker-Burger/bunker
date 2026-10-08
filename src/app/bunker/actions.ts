"use server";

import { redirect } from "next/navigation";
import { signInAdmin, signOutAdmin } from "@/server/auth/admin-auth";
import type { SignInState } from "@/server/auth/messages";
import { ADMIN_LOGIN, safeAdminPath } from "@/server/auth/safe-redirect";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Login form action: on success, goes to the requested page inside `/bunker/admin` only. */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = field(formData, "email").trim();
  const result = await signInAdmin(email, field(formData, "password"));
  if (!result.ok) return { error: result.message, email };
  redirect(safeAdminPath(formData.get("next")));
}

/**
 * Ends this device's session and returns to the login page (which purges admin caches). The
 * banner there says whether Supabase confirmed the revocation or only this device was cleared.
 */
export async function signOut(): Promise<void> {
  const outcome = await signOutAdmin();
  redirect(`${ADMIN_LOGIN}?sesion=${outcome === "revoked" ? "cerrada" : "local"}`);
}
