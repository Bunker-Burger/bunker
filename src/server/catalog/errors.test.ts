import { describe, expect, it } from "vitest";
import { fromSupabaseError } from "./errors";

describe("fromSupabaseError", () => {
  it.each([
    [{ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, undefined, "not_found"],
    [{ code: "42501", message: "permission denied for table products" }, 403, "unauthorized"],
    [{ code: "PGRST301", message: "JWT expired" }, 401, "unauthorized"],
    [{ code: "", message: "" }, 401, "unauthorized"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, 500, "unavailable"],
    [{ code: "PGRST002", message: "Could not query the database for the schema cache" }, 503, "unavailable"],
    [new TypeError("fetch failed"), undefined, "unavailable"]
  ])("maps %o (HTTP %s) to %s", (error, status, code) => {
    const result = fromSupabaseError("products.select", error, status);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(code);
    expect(result.error.message).toMatch(/^products\.select/);
    expect(result.error.cause).toBe(error);
  });
});
