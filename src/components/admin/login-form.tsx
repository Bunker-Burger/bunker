"use client";

import { LogIn } from "lucide-react";
import { useActionState } from "react";
import { signIn } from "@/app/bunker/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INITIAL_SIGN_IN_STATE } from "@/server/auth/messages";

interface LoginFormProps {
  /** Already-sanitized destination inside `/bunker/admin`; the server re-checks it anyway. */
  next: string;
}

/** Email + password only: admins are provisioned by hand, there is no sign-up or reset here. */
export function LoginForm({ next }: LoginFormProps) {
  const [state, action, pending] = useActionState(signIn, INITIAL_SIGN_IN_STATE);

  return (
    <form action={action} className="grid gap-5">
      <input name="next" type="hidden" value={next} />
      <div className="grid gap-2">
        <Label htmlFor="admin-email">Email</Label>
        <Input
          aria-describedby={state.error ? "admin-login-error" : undefined}
          aria-invalid={state.error ? true : undefined}
          autoComplete="username"
          defaultValue={state.email}
          id="admin-email"
          inputMode="email"
          key={state.email}
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="admin-password">Contraseña</Label>
        <Input
          aria-describedby={state.error ? "admin-login-error" : undefined}
          aria-invalid={state.error ? true : undefined}
          autoComplete="current-password"
          id="admin-password"
          maxLength={256}
          name="password"
          required
          type="password"
        />
      </div>
      {state.error ? (
        <p className="m-0 rounded-md border border-danger bg-danger-soft px-3 py-2 text-body text-foreground" id="admin-login-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button loading={pending} type="submit">
        {pending ? null : <LogIn aria-hidden="true" />}
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
