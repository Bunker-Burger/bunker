import { err, ok, type Result } from "@/lib/result";

export type SupabaseProjectEnv = "development" | "production";

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  projectRef: string;
  projectEnv: SupabaseProjectEnv;
}

export interface SupabaseConfigError {
  code: "misconfigured";
  message: string;
}

export interface SupabaseEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
  /** Which cloud project the credentials above belong to: "development" or "production". */
  SUPABASE_PROJECT_ENV?: string | undefined;
  /** Production project ref; when set, non-production deployments refuse to use it. */
  SUPABASE_PRODUCTION_PROJECT_REF?: string | undefined;
  /** Set by Vercel: "production" | "preview" | "development". Absent locally and in CI. */
  VERCEL_ENV?: string | undefined;
}

function processSupabaseEnv(): SupabaseEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_PROJECT_ENV: process.env.SUPABASE_PROJECT_ENV,
    SUPABASE_PRODUCTION_PROJECT_REF: process.env.SUPABASE_PRODUCTION_PROJECT_REF,
    VERCEL_ENV: process.env.VERCEL_ENV
  };
}

const misconfigured = (message: string) => err<SupabaseConfigError>({ code: "misconfigured", message });

/**
 * Reads the Supabase credentials and enforces the dev/prod split: only the Vercel production
 * deployment may talk to the production project, and every other context (local, CI,
 * previews) must use the development project.
 */
export function readSupabaseConfig(env: SupabaseEnv = processSupabaseEnv()): Result<SupabaseConfig, SupabaseConfigError> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    return misconfigured("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required");
  }

  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return misconfigured("NEXT_PUBLIC_SUPABASE_URL must use https");
    hostname = parsed.hostname;
  } catch {
    return misconfigured("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  const projectRef = /^([a-z0-9]{20})\.supabase\.co$/.exec(hostname)?.[1];
  if (!projectRef) return misconfigured("NEXT_PUBLIC_SUPABASE_URL must be a https://<project-ref>.supabase.co URL");

  if (publishableKey.startsWith("sb_secret_")) {
    return misconfigured("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key; use the publishable key");
  }

  const projectEnv = env.SUPABASE_PROJECT_ENV?.trim();
  if (projectEnv !== "development" && projectEnv !== "production") {
    return misconfigured('SUPABASE_PROJECT_ENV must be "development" or "production"');
  }

  const productionDeployment = env.VERCEL_ENV === "production";
  if (productionDeployment && projectEnv !== "production") {
    return misconfigured("The production deployment must use the production Supabase project");
  }
  if (!productionDeployment && projectEnv === "production") {
    return misconfigured("Only the production deployment may use the production Supabase project");
  }
  const productionRef = env.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  if (!productionDeployment && productionRef && productionRef === projectRef) {
    return misconfigured("Development credentials point at the production project ref");
  }

  return ok({ url: url.replace(/\/+$/, ""), publishableKey, projectRef, projectEnv });
}

export function catalogImageBaseUrl(config: Pick<SupabaseConfig, "url">) {
  return `${config.url}/storage/v1/object/public/catalog`;
}
