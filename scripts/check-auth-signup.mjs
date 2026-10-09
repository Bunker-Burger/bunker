#!/usr/bin/env node
/*
 * Verifies, against a real Supabase cloud project, that public sign-up is disabled while email
 * + password sign-in stays available for manually provisioned admins (BB-11).
 *
 * MODES:
 * 1. Default (read-only): GET /auth/v1/settings must report `disable_signup: true` and
 *    `external.email: true`. Never sends a POST request.
 * 2. Active probe (opt-in via --active-probe, development only):
 *    - Step 1: GET /auth/v1/settings (must have disable_signup: true and external.email: true).
 *    - Step 2: POST /auth/v1/signup with a non-deliverable address (example.invalid).
 *      Must return HTTP 422/400 with error_code: "signup_disabled" and NO user.
 *      HTTP 5xx (including 503) is strictly rejected as a failure.
 *    - Step 3: GET /auth/v1/settings must confirm settings remained unchanged (TOCTOU guard).
 *      If a user is returned or settings change, fails with cleanup alert. Never retries.
 *
 * Inputs (environment): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * EXPECTED_PROJECT_REF (must belong to development allowlist).
 * Prints only booleans, codes, and canonical ref; never keys, secrets, or passwords.
 * Requests never follow redirects (redirect: "error"), and any 3xx fails: only the canonical origin
 * may answer, and the probe body and apikey are never resent elsewhere.
 * When GITHUB_STEP_SUMMARY is set, the summary is part of the evidence: failing to write it fails.
 * Exit code 0 only when every check passed.
 */
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ALLOWED_PROJECT_REFS = new Set(["zokkgocmcaqcujltfkjf"]);

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const expectedRef = process.env.EXPECTED_PROJECT_REF ?? "zokkgocmcaqcujltfkjf";
const activeProbe = process.argv.includes("--active-probe");

const lines = [];

function report(line) {
  console.log(line);
  lines.push(line);
}

function finish(ok) {
  const result = ok ? "RESULT: PASS — public sign-up is disabled; email sign-in is enabled." : "RESULT: FAIL";
  // El resumen del paso es parte de la evidencia auditable: si no se puede escribir, el run no es PASS.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Supabase Auth: registro público\n\n\`\`\`\n${[...lines, result].join("\n")}\n\`\`\`\n`
      );
    } catch (err) {
      // Solo el código de error del sistema: sin rutas, claves ni mensajes con datos del entorno.
      console.error(`WARNING: could not write GITHUB_STEP_SUMMARY (${err?.code ?? "unknown error"}); the audit record is incomplete.`);
      console.log("RESULT: FAIL — the step summary is required evidence and could not be written.");
      process.exit(1);
    }
  }
  console.log(result);
  process.exit(ok ? 0 : 1);
}

// 1. Validar presencia de variables de entorno y formato del ref esperado
if (!rawUrl || typeof rawUrl !== "string" || !key || typeof key !== "string" || !/^[a-z0-9]{20}$/.test(expectedRef)) {
  report("Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or a valid EXPECTED_PROJECT_REF.");
  finish(false);
}

// 2. Allowlist estricta de desarrollo
if (!ALLOWED_PROJECT_REFS.has(expectedRef)) {
  report(`Project ref "${expectedRef}" is not in the allowed development projects list.`);
  finish(false);
}

// 3. Validación canónica estricta del origen antes de cualquier llamada a fetch
let canonicalOrigin;
try {
  const parsed = new URL(rawUrl);
  const expectedHost = `${expectedRef}.supabase.co`;

  // Protocolo exacto https:
  if (parsed.protocol !== "https:") {
    report(`Invalid protocol "${parsed.protocol}": must be https:.`);
    finish(false);
  }

  // Prohibir userinfo (username / password)
  if (parsed.username !== "" || parsed.password !== "") {
    report("Userinfo (username/password) is forbidden in NEXT_PUBLIC_SUPABASE_URL.");
    finish(false);
  }

  // Prohibir puertos explícitos (debe ser el puerto 443 estándar por defecto)
  if (parsed.port !== "") {
    report(`Explicit port "${parsed.port}" is forbidden in NEXT_PUBLIC_SUPABASE_URL.`);
    finish(false);
  }

  // Hostname debe tener exactamente 3 partes: [ref, "supabase", "co"]
  const hostParts = parsed.hostname.split(".");
  if (
    parsed.hostname !== expectedHost ||
    hostParts.length !== 3 ||
    hostParts[0] !== expectedRef ||
    hostParts[1] !== "supabase" ||
    hostParts[2] !== "co"
  ) {
    report(`Hostname "${parsed.hostname}" does not match expected canonical host "${expectedHost}".`);
    finish(false);
  }

  // Pathname debe ser estrictamente vacío o "/"
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    report("Pathname is forbidden in NEXT_PUBLIC_SUPABASE_URL.");
    finish(false);
  }

  // Query parameters prohibidos
  if (parsed.search !== "") {
    report("Query parameters are forbidden in NEXT_PUBLIC_SUPABASE_URL.");
    finish(false);
  }

  // Hash fragment prohibido
  if (parsed.hash !== "") {
    report("Hash fragment is forbidden in NEXT_PUBLIC_SUPABASE_URL.");
    finish(false);
  }

  // Comprobar que la URL cruda normalizada coincida exactamente con el origen canónico
  const normalizedRaw = rawUrl.replace(/\/+$/, "");
  if (normalizedRaw !== `https://${expectedHost}`) {
    report(`URL format is not canonical: must be exactly "https://${expectedHost}".`);
    finish(false);
  }

  canonicalOrigin = `https://${expectedHost}`;
} catch (err) {
  report("Invalid URL format.");
  finish(false);
}

report(`project_ref: ${expectedRef} (canonical origin: ${canonicalOrigin})`);

const headers = { apikey: key, "content-type": "application/json" };

async function readSettings() {
  let response;
  try {
    // Nunca seguir redirecciones: otro origen no puede responder por el proyecto ni recibir el apikey.
    response = await fetch(`${canonicalOrigin}/auth/v1/settings`, { headers, redirect: "error" });
    report(`GET /auth/v1/settings: HTTP ${response.status}`);
  } catch (err) {
    report(`Network error reading /auth/v1/settings: ${err.message}`);
    return { ok: false, settings: null };
  }

  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    report(`Redirect refused from /auth/v1/settings (HTTP ${response.status}): only the canonical origin may answer.`);
    return { ok: false, settings: null };
  }

  if (response.status !== 200) {
    report(`Unexpected status from settings endpoint: expected 200, got ${response.status}`);
    return { ok: false, settings: null };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    report(`Malformed JSON received from /auth/v1/settings: ${err.message}`);
    return { ok: false, settings: null };
  }

  if (!data || typeof data !== "object") {
    report("Malformed JSON received from /auth/v1/settings: payload is not an object");
    return { ok: false, settings: null };
  }
  return { ok: true, settings: data };
}

// 4. Lectura de configuración inicial
const { ok: settingsOk, settings } = await readSettings();
if (!settingsOk || !settings) {
  finish(false);
}

const disableSignupValid = settings.disable_signup === true;
const emailEnabledValid = settings.external?.email === true;

report(`disable_signup === true: ${disableSignupValid}`);
report(`external.email === true: ${emailEnabledValid}`);

if (!disableSignupValid || !emailEnabledValid) {
  if (activeProbe) {
    report("Sign-up probe NOT sent: project does not report sign-up disabled with email enabled.");
  }
  report('Ask the project owner to turn off "Allow new users to sign up" (Authentication → Sign In / Providers).');
  finish(false);
}

// 5. Modo por defecto: solo lectura (sin POST probe)
if (!activeProbe) {
  report("Mode: read-only (default). Active sign-up probe omitted.");
  finish(true);
}

// 6. Modo activo: probe POST explícito (opt-in autorizado en development)
report("Mode: active probe (opt-in authorized on development).");
const probe = {
  email: `signup-probe-${randomUUID()}@example.invalid`,
  password: `Probe-${randomUUID()}!`
};

let signUpResponse;
let body = {};
try {
  signUpResponse = await fetch(`${canonicalOrigin}/auth/v1/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify(probe),
    // Un 307/308 reenviaría cuerpo, contraseña de sonda y apikey a otro origen.
    redirect: "error"
  });
  body = await signUpResponse.json().catch(() => ({}));
} catch (err) {
  report(`Network error during active probe: ${err.message}`);
  finish(false);
}

if (signUpResponse.redirected || (signUpResponse.status >= 300 && signUpResponse.status < 400)) {
  report(`FAIL: redirect refused from /auth/v1/signup (HTTP ${signUpResponse.status}); the probe result is not trusted.`);
  finish(false);
}

const errorCode = body.error_code ?? (typeof body.code === "string" ? body.code : null);
const returnedUser = Boolean(body.id || body.user || body.access_token || body.session);

report(`POST /auth/v1/signup (probe): HTTP ${signUpResponse.status}, error_code: ${errorCode}`);
report(`user returned: ${returnedUser}`);

// Solo se aceptan códigos 4xx de rechazo por cliente (422 o 400). HTTP 5xx (incluido 503) es FAIL.
const isExpectedClientRejection = [400, 422].includes(signUpResponse.status);
const isExpectedErrorCode = errorCode === "signup_disabled";

report(`status in [400, 422]: ${isExpectedClientRejection}`);
report(`error_code === "signup_disabled": ${isExpectedErrorCode}`);

// Re-lectura para detectar TOCTOU
const { ok: afterOk, settings: afterSettings } = await readSettings();
const unchanged =
  afterOk &&
  afterSettings &&
  afterSettings.disable_signup === true &&
  afterSettings.external?.email === true;
report(`settings unchanged after the probe: ${Boolean(unchanged)}`);

if (returnedUser || signUpResponse.ok) {
  report(`ALERT: the probe was accepted; an unconfirmed account may exist for ${probe.email}.`);
  report("Delete it in Authentication → Users and turn off \"Allow new users to sign up\" before running again.");
  finish(false);
}

if (!unchanged) {
  report("ALERT: settings changed during probe execution (TOCTOU violation).");
  finish(false);
}

if (!isExpectedClientRejection) {
  report(`FAIL: unexpected probe response HTTP status ${signUpResponse.status} (expected 422/400 client rejection, never 5xx/2xx/3xx).`);
  finish(false);
}

if (!isExpectedErrorCode) {
  report(`FAIL: unexpected error code "${errorCode}" (expected "signup_disabled").`);
  finish(false);
}

finish(true);
