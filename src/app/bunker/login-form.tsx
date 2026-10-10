"use client";

import { useActionState } from "react";
import { login, type LoginActionState } from "./actions";
import styles from "./admin.module.css";

const initialState: LoginActionState = { message: null };

export function LoginForm({ action = login }: { action?: typeof login }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <label className={styles.field}>
        <span>Email</span>
        <input autoComplete="username" inputMode="email" maxLength={320} name="email" required type="email" />
      </label>
      <label className={styles.field}>
        <span>Contraseña</span>
        <input autoComplete="current-password" maxLength={1024} name="password" required type="password" />
      </label>
      {state.message ? <p className={styles.error} role="alert">{state.message}</p> : null}
      <button className={styles.primaryAction} disabled={pending} type="submit">
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
