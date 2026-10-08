import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_CACHE_TAG,
  CATALOG_REVALIDATE_SECONDS,
  createOperationalReadClient,
  createPublicReadClient,
  createSessionClient
} from "./clients";
import type { SupabaseConfig } from "./config";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined })
}));

const config: SupabaseConfig = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_test",
  projectRef: "abcdefghijklmnopqrst",
  projectEnv: "development"
};

type CapturedInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };

/** Captures the RequestInit each client hands to fetch; the response is an empty result set. */
function captureFetch() {
  const calls: CapturedInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: CapturedInit) => {
      calls.push(init ?? {});
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Supabase clients", () => {
  it("public reads go through Next's data cache with the catalog tag", async () => {
    const calls = captureFetch();
    await createPublicReadClient(config).from("categories").select("id");
    expect(calls[0]).toMatchObject({
      cache: "force-cache",
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] }
    });
  });

  it("operational reads (store status) are never cached nor tagged", async () => {
    const calls = captureFetch();
    await createOperationalReadClient(config).from("stores").select("id");
    expect(calls[0]?.cache).toBe("no-store");
    expect(calls[0]?.next).toBeUndefined();
  });

  it("session (admin) reads are never cached", async () => {
    const calls = captureFetch();
    const client = await createSessionClient(config);
    await client.from("categories").select("id");
    const last = calls.at(-1);
    expect(last?.cache).toBe("no-store");
    expect(last?.next).toBeUndefined();
  });
});
