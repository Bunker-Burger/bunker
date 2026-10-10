"use client";

import { createContext, useActionState, useContext, useId, type ComponentProps, type ReactNode } from "react";
import styles from "../admin.module.css";
import { IDLE_FORM_STATE, type AdminFormState } from "./form-state";

type FormAction = (state: AdminFormState, form: FormData) => Promise<AdminFormState>;

const FormStateContext = createContext<AdminFormState>(IDLE_FORM_STATE);

interface AdminFormProps {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  /** Accessible name when the visible label is an icon or arrow. */
  submitAriaLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "icon";
  className?: string | undefined;
}

const SUBMIT_CLASS = {
  primary: styles.primaryAction,
  secondary: styles.secondaryAction,
  danger: styles.dangerAction,
  icon: styles.iconAction
};

/**
 * A form bound to an admin Server Action: shows the success message (status) or the error
 * (alert), the publication problems and, through `FieldError`, the message for each field.
 */
export function AdminForm({ action, children, submitLabel, pendingLabel, submitAriaLabel, submitVariant = "primary", className }: AdminFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} className={className ?? styles.adminForm} noValidate>
        {children}
        <button aria-label={submitAriaLabel} className={SUBMIT_CLASS[submitVariant]} disabled={pending} type="submit">
          {pending ? (pendingLabel ?? "Guardando…") : submitLabel}
        </button>
        <FormStatus state={state} />
      </form>
    </FormStateContext.Provider>
  );
}

function FormStatus({ state }: { state: AdminFormState }) {
  if (state.status === "idle" || !state.message) return null;
  if (state.status === "success") {
    return (
      <p className={styles.success} role="status">
        {state.message}
      </p>
    );
  }
  return (
    <div className={styles.error} role="alert">
      <p>{state.message}</p>
      {state.issues && state.issues.length > 0 ? (
        <ul>
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The server's message for one field of the surrounding `AdminForm`, linked by `id`. */
export function FieldError({ name, id }: { name: string; id: string }) {
  const message = useContext(FormStateContext).fieldErrors?.[name];
  return message ? (
    <span className={styles.fieldError} id={id}>
      {message}
    </span>
  ) : null;
}

interface FieldProps {
  name: string;
  label: string;
  hint?: string;
}

/** Ids for one field instance; several forms on a page share field names. */
function useFieldA11y(name: string, hint?: string) {
  const invalid = Boolean(useContext(FormStateContext).fieldErrors?.[name]);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;
  return { inputId: id, invalid, errorId, hintId, describedBy };
}

// Hints and errors sit outside the <label> so they describe the field instead of renaming it.

export function TextField({ name, label, hint, ...input }: FieldProps & Omit<ComponentProps<"input">, "name">) {
  const { inputId, invalid, errorId, hintId, describedBy } = useFieldA11y(name, hint);
  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>{label}</label>
      <input aria-describedby={describedBy} aria-invalid={invalid || undefined} id={inputId} name={name} {...input} />
      {hint ? <small className={styles.hint} id={hintId}>{hint}</small> : null}
      <FieldError id={errorId} name={name} />
    </div>
  );
}

export function TextAreaField({ name, label, hint, ...textarea }: FieldProps & Omit<ComponentProps<"textarea">, "name">) {
  const { inputId, invalid, errorId, hintId, describedBy } = useFieldA11y(name, hint);
  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>{label}</label>
      <textarea aria-describedby={describedBy} aria-invalid={invalid || undefined} id={inputId} name={name} {...textarea} />
      {hint ? <small className={styles.hint} id={hintId}>{hint}</small> : null}
      <FieldError id={errorId} name={name} />
    </div>
  );
}

export function CheckboxField({ name, label, hint, ...input }: FieldProps & Omit<ComponentProps<"input">, "name" | "type">) {
  const { inputId, invalid, errorId, hintId, describedBy } = useFieldA11y(name, hint);
  return (
    <div className={styles.checkField}>
      <input aria-describedby={describedBy} aria-invalid={invalid || undefined} id={inputId} name={name} type="checkbox" {...input} />
      <label htmlFor={inputId}>{label}</label>
      {hint ? <small className={styles.hint} id={hintId}>{hint}</small> : null}
      <FieldError id={errorId} name={name} />
    </div>
  );
}

/** A native <select> with the same label/error wiring as the other fields. */
export function SelectField({ name, label, children, ...select }: FieldProps & Omit<ComponentProps<"select">, "name">) {
  const { inputId, invalid, errorId, describedBy } = useFieldA11y(name);
  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>{label}</label>
      <select aria-describedby={describedBy} aria-invalid={invalid || undefined} id={inputId} name={name} {...select}>
        {children}
      </select>
      <FieldError id={errorId} name={name} />
    </div>
  );
}
