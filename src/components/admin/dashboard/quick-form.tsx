"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ARS_DECIMAL } from "@/lib/money";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "./dashboard.module.css";
import { IDLE_FORM_STATE, type AdminFormState } from "@/app/bunker/admin/form-state";

type FormAction = (state: AdminFormState, form: FormData) => Promise<AdminFormState>;

/**
 * A compact form for the control panel (issue #54): the same admin Server Actions as the full
 * screens, with its result in one short line and the panel re-read after a change is saved.
 */
export function QuickForm({ action, children, className, label, id }: { action: FormAction; children: ReactNode; className?: string | undefined; label: string; id?: string }) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} aria-label={label} className={className} id={id} noValidate>
      {children}
      {state.status === "error" && state.message ? (
        <p className={shared.quickError} role="alert">
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


/** "7800" → "7.800"; what the admin parsers expect stays in the hidden field ("7800", "7800.5"). */
export function PriceField({ name, defaultValue, label, id, form }: { name: string; defaultValue: string; label?: string; id?: string; form?: string }) {
  const [plain, setPlain] = useState(defaultValue);
  const [shown, setShown] = useState(() => (defaultValue === "" ? "" : ARS_DECIMAL.format(Number(defaultValue))));
  return (
    <span className={shared.priceInput}>
      <span aria-hidden="true">$</span>
      <input
        aria-label={label}
        // In a row of another form (the product's), Enter and the value go to this field's own form.
        form={form}
        id={id}
        inputMode="decimal"
        onBlur={() => setShown(plain === "" ? "" : ARS_DECIMAL.format(Number(plain)))}
        onChange={(event) => {
          // Dots are thousands, a comma is the decimal separator (es-AR).
          const typed = event.target.value.replace(/[^\d,]/g, "");
          setShown(event.target.value);
          setPlain(typed.replace(",", "."));
        }}
        type="text"
        value={shown}
      />
      <input form={form} name={name} type="hidden" value={plain} />
    </span>
  );
}
