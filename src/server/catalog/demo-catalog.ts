import type { Result } from "@/lib/result";
import type { CatalogError } from "./errors";

/**
 * BB-18: the static demo menu (src/data/catalog.ts) only stands in when Supabase is not configured
 * at all and the build is not a Vercel deployment (local work, CI). A deployment, or a configured
 * project that fails to answer, shows no products until the real catalog is read: never invented
 * products, prices or photos.
 */
export function allowsDemoCatalog(catalog: Result<unknown, CatalogError>, vercelEnv: string | undefined): boolean {
  return !catalog.ok && catalog.error.code === "misconfigured" && !vercelEnv?.trim();
}
