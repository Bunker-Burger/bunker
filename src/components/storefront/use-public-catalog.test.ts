import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fallbackProducts, categories as fixtureCategories } from "@/data/catalog";
import { serializePublicCategories, serializePublicProducts } from "@/server/catalog/public-products";
import { usePublicCatalog } from "./use-public-catalog";

describe("usePublicCatalog hook (P1 B concurrency & lifecycle)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carrera de respuestas con json() diferido: respuesta A vieja no sobrescribe respuesta B más reciente", async () => {
    const catalogA = serializePublicProducts([
      {
        ...fallbackProducts[0]!,
        priceCents: 100000n
      }
    ]);

    const catalogB = serializePublicProducts([
      {
        ...fallbackProducts[0]!,
        priceCents: 200000n
      }
    ]);

    let resolveJsonA: (val: unknown) => void;
    const jsonPromiseA = new Promise((resolve) => {
      resolveJsonA = resolve;
    });

    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          // Request A: HTTP 200 resolves immediately, but json() is deferred
          return {
            ok: true,
            status: 200,
            json: () => jsonPromiseA
          } as unknown as Response;
        } else {
          // Request B: HTTP 200 and json() resolve immediately with catalog B
          return {
            ok: true,
            status: 200,
            json: async () => ({ products: catalogB, categories: serializePublicCategories(fixtureCategories) })
          } as unknown as Response;
        }
      })
    );

    const { result } = renderHook(() => usePublicCatalog());

    // Initially pending
    expect(result.current.verificationStatus).toBe("pending");

    // Trigger second fetch (Request B) before Request A's json() resolves
    await act(async () => {
      result.current.recheckProducts();
    });

    // Request B should finish and apply catalog B
    await waitFor(() => {
      expect(result.current.verificationStatus).toBe("verified");
      expect(result.current.products[0]?.priceCents).toBe(200000n);
    });

    // Now Request A's json() finally finishes with stale catalog A
    await act(async () => {
      resolveJsonA!({ products: catalogA, categories: serializePublicCategories(fixtureCategories) });
    });

    // CRITICAL: Stale Request A MUST NOT overwrite Request B!
    expect(result.current.verificationStatus).toBe("verified");
    expect(result.current.products[0]?.priceCents).toBe(200000n);
  });

  it("transición verified -> pending al ejecutar recheckProducts y manejo de fallo de red", async () => {
    const catalogValid = serializePublicProducts(fallbackProducts);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ products: catalogValid, categories: serializePublicCategories(fixtureCategories) })
      }))
    );

    const { result } = renderHook(() => usePublicCatalog());

    await waitFor(() => {
      expect(result.current.verificationStatus).toBe("verified");
    });

    // Now mock network failure on next call
    let rejectFetch: (err: unknown) => void;
    const pendingFetchPromise = new Promise<Response>((_, reject) => {
      rejectFetch = reject;
    });

    vi.stubGlobal("fetch", vi.fn(() => pendingFetchPromise));

    // When recheck starts, status MUST immediately become "pending"
    act(() => {
      result.current.recheckProducts();
    });
    expect(result.current.verificationStatus).toBe("pending");

    // Network fails
    await act(async () => {
      rejectFetch!(new Error("Network offline"));
    });

    // Must transition to "unverified" without crashing or clearing products
    await waitFor(() => {
      expect(result.current.verificationStatus).toBe("unverified");
    });
    expect(result.current.products.length).toBeGreaterThan(0);
  });
});
