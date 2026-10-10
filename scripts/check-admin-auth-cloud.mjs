#!/usr/bin/env node
/*
 * Trusted-main Supabase Auth probe for BB-11. This file is intentionally
 * self-contained: the privileged workflow runs it from main and never checks
 * out or executes JavaScript from the reviewed PR SHA.
 */
import { appendFileSync } from "node:fs";

export function isBunkerOwner(rows) {
  return (
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0]?.role === "owner" &&
    rows[0]?.is_active === true &&
    rows[0]?.stores?.slug === "bunker-burger"
  );
}

export async function run(fetchImpl, env = process.env, writeSummary = true) {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const email = env.SUPABASE_TEST_ADMIN_EMAIL ?? "";
  const password = env.SUPABASE_TEST_ADMIN_PASSWORD ?? "";
  const expectedRef = env.EXPECTED_PROJECT_REF ?? "";
  const results = [];
  const record = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    const parsed = new URL(url);
    const ref = parsed.hostname.split(".")[0];
    if (parsed.protocol !== "https:" || parsed.hostname !== `${expectedRef}.supabase.co` || parsed.pathname !== "/") {
      throw new Error("non-canonical development project URL");
    }
    if (!/^[a-z0-9]{20}$/.test(ref) || !key || !email || !password) {
      throw new Error("required cloud Auth inputs are missing");
    }

    const headers = { apikey: key, "content-type": "application/json" };
    const invalid = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers, redirect: "error", body: JSON.stringify({ email, password: `${password}-invalid` })
    });
    record("invalid password is rejected by cloud Auth", invalid.status === 400 || invalid.status === 422, `HTTP ${invalid.status}`);

    const valid = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers, redirect: "error", body: JSON.stringify({ email, password })
    });
    const session = await valid.json().catch(() => ({}));
    const accessToken = typeof session.access_token === "string" ? session.access_token : "";
    const userId = typeof session.user?.id === "string" ? session.user.id : "";
    let owner = false;
    let logoutOk = false;
    if (valid.ok && accessToken && userId) {
      const membership = await fetchImpl(
        `${url}/rest/v1/admin_memberships?select=role,is_active,store_id,stores!inner(slug)&user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&stores.slug=eq.bunker-burger`,
        { headers: { ...headers, Authorization: `Bearer ${accessToken}` }, redirect: "error" }
      );
      const rows = await membership.json().catch(() => []);
      owner = membership.ok && isBunkerOwner(rows);
      const logout = await fetchImpl(`${url}/auth/v1/logout?scope=local`, {
        method: "POST", headers: { ...headers, Authorization: `Bearer ${accessToken}` }, redirect: "error"
      });
      logoutOk = logout.status === 204;
      if (!logoutOk) record("local Auth logout returns HTTP 204", false, `HTTP ${logout.status}`);
    }
    record("sole development owner authenticates for bunker-burger and closes locally", owner && logoutOk, `HTTP ${valid.status}`);
  } catch (error) {
    record("cloud Auth harness request", false, error instanceof Error ? error.message : "unexpected error");
  }

  const passed = results.length === 2 && results.every((result) => result.ok);
  const summary = [
    "### BB-11 cloud Auth configuration harness",
    "",
    ...results.map((result) => `- ${result.ok ? "PASS" : "FAIL"}: ${result.name}`),
    "",
    `Result: ${passed ? "PASS" : "FAIL"}`
  ].join("\n");
  if (writeSummary && env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  return { passed, results };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/check-admin-auth-cloud.mjs")) {
  const result = await run(globalThis.fetch);
  process.exit(result.passed ? 0 : 1);
}
