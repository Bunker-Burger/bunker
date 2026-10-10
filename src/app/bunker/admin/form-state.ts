export interface AdminFormState {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors?: Record<string, string>;
  /** Publication rules that failed, one sentence each. */
  issues?: string[];
}

export const IDLE_FORM_STATE: AdminFormState = { status: "idle", message: null };
