import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { CatalogErrorCode } from "./errors";
import { allowsDemoCatalog } from "./demo-catalog";

const failed = (code: CatalogErrorCode) => err({ code, message: code });

describe("allowsDemoCatalog (BB-18)", () => {
  it("allows the demo menu only without Supabase and outside Vercel", () => {
    expect(allowsDemoCatalog(failed("misconfigured"), undefined)).toBe(true);
    expect(allowsDemoCatalog(failed("misconfigured"), " ")).toBe(true);
  });

  it.each(["production", "preview", "development"])("never on a Vercel %s deployment", (vercelEnv) => {
    expect(allowsDemoCatalog(failed("misconfigured"), vercelEnv)).toBe(false);
  });

  it.each(["unavailable", "invalid_data", "not_found", "unauthorized"] as const)(
    "never when a configured project fails (%s)",
    (code) => {
      expect(allowsDemoCatalog(failed(code), undefined)).toBe(false);
    }
  );

  it("never when the catalog was read", () => {
    expect(allowsDemoCatalog(ok({ products: [] }), undefined)).toBe(false);
  });
});
