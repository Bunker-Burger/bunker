"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authenticateStoreAdmin, signOutCurrentSession } from "@/server/auth/admin-session";
import { ADMIN_HOME_PATH, ADMIN_LOGIN_PATH } from "./paths";

const INVALID_CREDENTIALS_MESSAGE = "Email o contraseña incorrectos";
const UNAVAILABLE_MESSAGE = "No pudimos iniciar sesión. Intentá nuevamente.";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  password: z
    .string()
    .max(1024)
    .refine((password) => password.trim().length > 0)
});

export interface LoginActionState {
  message: string | null;
}

export async function login(_previousState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });
  if (!parsed.success) return { message: INVALID_CREDENTIALS_MESSAGE };

  const outcome = await authenticateStoreAdmin(parsed.data);
  if (outcome.kind === "rejected") return { message: INVALID_CREDENTIALS_MESSAGE };
  if (outcome.kind === "unavailable") return { message: UNAVAILABLE_MESSAGE };

  redirect(ADMIN_HOME_PATH);
}

export async function logout(): Promise<never> {
  await signOutCurrentSession();
  revalidatePath("/", "layout");
  redirect(ADMIN_LOGIN_PATH);
}
