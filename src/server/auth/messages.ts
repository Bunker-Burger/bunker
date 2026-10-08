export interface SignInState {
  error: string | null;
  email: string;
}

export const INITIAL_SIGN_IN_STATE: SignInState = { error: null, email: "" };

/** One message for a wrong password, an unknown email and a non-admin account: no enumeration. */
export const INVALID_CREDENTIALS = "Email o contraseña incorrectos, o la cuenta no tiene acceso de administración.";
export const INVALID_INPUT = "Ingresá un email válido y tu contraseña.";
export const TOO_MANY_ATTEMPTS = "Demasiados intentos. Esperá unos minutos y volvé a probar.";
export const AUTH_UNAVAILABLE = "No pudimos verificar tu acceso. Intentá de nuevo en unos minutos.";
