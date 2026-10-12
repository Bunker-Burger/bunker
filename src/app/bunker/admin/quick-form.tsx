"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin.module.css";
import { IDLE_FORM_STATE, type AdminFormState } from "./form-state";

type FormAction = (state: AdminFormState, form: FormData) => Promise<AdminFormState>;

/**
 * A compact form for the control panel (issue #54): the same admin Server Actions as the full
 * screens, with its result in one short line and the panel re-read after a change is saved.
 */
export function QuickForm({ action, children, className, label }: { action: FormAction; children: ReactNode; className?: string | undefined; label: string }) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} aria-label={label} className={className} noValidate>
      {children}
      {state.status === "error" && state.message ? (
        <p className={styles.quickError} role="alert">
          {[state.message, ...Object.values(state.fieldErrors ?? {}), ...(state.issues ?? [])].join(" ")}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p className="sr-only" role="status">
          {state.message ?? "Guardado."}
        </p>
      ) : null}
    </form>
  );
}

export function QuickSubmit({ children, className, ariaLabel }: { children: ReactNode; className?: string | undefined; ariaLabel?: string | undefined }) {
  const { pending } = useFormStatus();
  return (
    <button aria-label={ariaLabel} className={className} disabled={pending} type="submit">
      {pending ? "…" : children}
    </button>
  );
}

/** A switch that saves its form as soon as it changes (availability, active promotion). */
export function QuickToggle({ name, defaultChecked, label, onLabel, offLabel }: { name: string; defaultChecked: boolean; label: string; onLabel: string; offLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <label className={styles.quickToggle}>
      <input
        aria-label={label}
        defaultChecked={defaultChecked}
        disabled={pending}
        name={name}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        type="checkbox"
        // "true" reads as on for every admin parser (checkboxes and the promotion's active flag).
        value="true"
      />
      <span aria-hidden="true">{defaultChecked ? onLabel : offLabel}</span>
    </label>
  );
}
