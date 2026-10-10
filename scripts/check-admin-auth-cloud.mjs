#!/usr/bin/env node
/*
 * Trusted-main Supabase Auth probe for BB-11. This file is intentionally
 * self-contained: the privileged workflow runs it from main and never checks
 * out or executes JavaScript from the reviewed PR SHA.
 */
import { appendFileSync } from "node:fs";

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const email = process.env.SUPABASE_TEST_ADMIN_EMAIL ?? "";
const password = process.env.SUPABASE_TEST_ADMIN_PASSWORD ?? "";
const expectedRef = process.env.EXPECTED_PROJECT_REF ?? "";
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function finish() {
  const passed = results.length === 2 && results.every((result) => result.ok);
  const summary = [
    "### BB-11 cloud Auth harness",
    "",
    ...results.map((result) => `- ${result.ok ? "PASS" : "FAIL"}: ${result.name}`),
    "",
    `Result: ${passed ? "PASS" : "FAIL"}`
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  process.exit(passed ? 0 : 1);
}

try {
  const parsed = new URL(url);
  const ref = parsed.hostname.split(".")[0];
  if (parsed.protocol !== "https:" || parsed.hostname !== `${expectedRef}.supabase.co` || parsed.pathname !== "/") {
    throw new Error("non-canonical development project URL");
  }
  if (!/^[a-z0-9]{20}$/.test(ref) || !key || !email || !password) throw new Error("required cloud Auth inputs are missing");

  const headers = { apikey: key, "content-type": "application/json" };
  const invalid = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers, redirect: "error", body: JSON.stringify({ email, password: `${password}-invalid` })
  });
  record("invalid password is rejected by cloud Auth", invalid.status === 400 || invalid.status === 422, `HTTP ${invalid.status}`);

  const valid = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers, redirect: "error", body: JSON.stringify({ email, password })
  });
  const session = await valid.json().catch(() => ({}));
  const accessToken = typeof session.access_token === "string" ? session.access_token : "";
  const userId = typeof session.user?.id === "string" ? session.user.id : "";
  let owner = false;
  if (valid.ok && accessToken && userId) {
    const membership = await fetch(
      `${url}/rest/v1/admin_memberships?select=role,is_active,store_id&user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true`,
      { headers: { ...headers, Authorization: `Bearer ${accessToken}` }, redirect: "error" }
    );
    const rows = await membership.json().catch(() => []);
    owner = membership.ok && Array.isArray(rows) && rows.length === 1 && rows[0]?.role === "owner";
    await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { ...headers, Authorization: `Bearer ${accessToken}` }, redirect: "error" });
  }
  record("sole development owner authenticates and has active owner membership", owner, `HTTP ${valid.status}`);
} catch (error) {
  record("cloud Auth harness request", false, error instanceof Error ? error.message : "unexpected error");
}

finish();
