"use client";

import { useActionState } from "react";
import { login, type LoginActionState } from "./actions";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "./admin.module.css";

const initialState: LoginActionState = { message: null };

export function LoginForm({ action = login }: { action?: typeof login }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <label className={shared.field}>
        <span>Email</span>
        <input autoComplete="username" inputMode="email" maxLength={320} name="email" required type="email" />
      </label>
      <label className={shared.field}>
        <span>Contraseña</span>
        <input autoComplete="current-password" maxLength={1024} name="password" required type="password" />
      </label>
      {state.message ? <p className={shared.error} role="alert">{state.message}</p> : null}
      <button className={shared.primaryAction} disabled={pending} type="submit">
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
