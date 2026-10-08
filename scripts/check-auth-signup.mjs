#!/usr/bin/env node
/*
 * Verifies, against a real Supabase cloud project, that public sign-up is disabled while email
 * + password sign-in stays available for manually provisioned admins (BB-11).
 *
 * 1. GET /auth/v1/settings must report `disable_signup: true` and `external.email: true`.
 * 2. Only then, a sign-up probe with a non-deliverable address must be refused with
 *    `signup_disabled` and return no user. If step 1 fails, the probe is never sent, so this
 *    script can never create a user.
 *
 * Inputs (environment): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * EXPECTED_PROJECT_REF (the URL must belong to that project). Prints only booleans, codes and
 * the project ref; never keys. Exit code 0 only when every check passed.
 */
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const expectedRef = process.env.EXPECTED_PROJECT_REF ?? "";
const lines = [];

function report(line) {
  console.log(line);
  lines.push(line);
}

function finish(ok) {
  report(ok ? "RESULT: PASS — public sign-up is disabled; email sign-in is enabled." : "RESULT: FAIL");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Supabase Auth: registro público\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  }
  process.exit(ok ? 0 : 1);
}

if (!url || !key || !/^[a-z0-9]{20}$/.test(expectedRef)) {
  report("Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or a valid EXPECTED_PROJECT_REF.");
  finish(false);
}

let ref;
try {
  const { protocol, hostname } = new URL(url);
  ref = protocol === "https:" && hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : "";
} catch {
  ref = "";
}
report(`project_ref: ${ref || "(not a supabase.co URL)"} (expected ${expectedRef})`);
if (ref !== expectedRef) finish(false);

const headers = { apikey: key, "content-type": "application/json" };

const settingsResponse = await fetch(`${url}/auth/v1/settings`, { headers });
const settings = settingsResponse.ok ? await settingsResponse.json() : {};
report(`GET /auth/v1/settings: HTTP ${settingsResponse.status}`);
report(`disable_signup === true: ${settings.disable_signup === true}`);
report(`external.email === true: ${settings.external?.email === true}`);
if (settings.disable_signup !== true || settings.external?.email !== true) {
  report("Sign-up probe NOT sent: the project does not report sign-up disabled with email enabled.");
  report('Ask the project owner to turn off "Allow new users to sign up" (Authentication → Sign In / Providers).');
  finish(false);
}

const probe = { email: `signup-probe-${randomUUID()}@example.invalid`, password: `Probe-${randomUUID()}` };
const signUpResponse = await fetch(`${url}/auth/v1/signup`, { method: "POST", headers, body: JSON.stringify(probe) });
const body = await signUpResponse.json().catch(() => ({}));
const errorCode = body.error_code ?? body.code ?? null;
const returnedUser = Boolean(body.id || body.user || body.access_token);
report(`POST /auth/v1/signup (probe): HTTP ${signUpResponse.status}, error_code: ${errorCode}`);
report(`error_code === "signup_disabled": ${errorCode === "signup_disabled"}`);
report(`user returned: ${returnedUser}`);
finish(!signUpResponse.ok && errorCode === "signup_disabled" && !returnedUser);
