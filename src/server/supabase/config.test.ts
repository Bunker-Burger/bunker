import { describe, expect, it } from "vitest";
import { catalogImageBaseUrl, readSupabaseConfig, type SupabaseEnv } from "./config";

const DEV_REF = "devprojectref0000000";
const PROD_REF = "prodprojectref000000";

const devEnv: SupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dev",
  SUPABASE_PROJECT_ENV: "development",
  SUPABASE_PRODUCTION_PROJECT_REF: PROD_REF
};

const prodEnv: SupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co/`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prod",
  SUPABASE_PROJECT_ENV: "production",
  SUPABASE_PRODUCTION_PROJECT_REF: PROD_REF,
  VERCEL_ENV: "production"
};

describe("readSupabaseConfig", () => {
  it("accepts development credentials locally, in CI and on previews", () => {
    for (const vercelEnv of [undefined, "development", "preview"]) {
      const result = readSupabaseConfig({ ...devEnv, VERCEL_ENV: vercelEnv });
      expect(result).toEqual({
        ok: true,
        value: { url: `https://${DEV_REF}.supabase.co`, publishableKey: "sb_publishable_dev", projectRef: DEV_REF, projectEnv: "development" }
      });
    }
  });

  it("accepts production credentials only on the production deployment", () => {
    const result = readSupabaseConfig(prodEnv);
    expect(result.ok && result.value).toMatchObject({ projectRef: PROD_REF, projectEnv: "production", url: `https://${PROD_REF}.supabase.co` });
  });

  it.each<[string, SupabaseEnv, RegExp]>([
    ["missing URL", { ...devEnv, NEXT_PUBLIC_SUPABASE_URL: "" }, /are required/],
    ["missing key", { ...devEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, /are required/],
    ["non-Supabase host", { ...devEnv, NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, /<project-ref>\.supabase\.co/],
    ["plain http", { ...devEnv, NEXT_PUBLIC_SUPABASE_URL: `http://${DEV_REF}.supabase.co` }, /https/],
    ["secret key in a public variable", { ...devEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" }, /secret key/],
    ["undeclared project", { ...devEnv, SUPABASE_PROJECT_ENV: undefined }, /SUPABASE_PROJECT_ENV/],
    ["production deployment on dev project", { ...devEnv, VERCEL_ENV: "production" }, /production deployment must use/],
    ["preview on prod project", { ...prodEnv, VERCEL_ENV: "preview" }, /Only the production deployment/],
    ["local run on prod project", { ...prodEnv, VERCEL_ENV: undefined }, /Only the production deployment/],
    [
      "dev label on the prod ref",
      { ...devEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` },
      /point at the production project/
    ]
  ])("rejects %s", (_case, env, message) => {
    const result = readSupabaseConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("misconfigured");
      expect(result.error.message).toMatch(message);
    }
  });

  it("derives the public catalog bucket URL", () => {
    expect(catalogImageBaseUrl({ url: `https://${DEV_REF}.supabase.co` })).toBe(
      `https://${DEV_REF}.supabase.co/storage/v1/object/public/catalog`
    );
  });
});
