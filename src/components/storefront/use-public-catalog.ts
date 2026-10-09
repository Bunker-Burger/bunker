"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { categories as fixtureCategories, products as fixtureProducts } from "@/data/catalog";
import { parsePublicCatalog } from "@/domain/public-products";
import type { Category, Product, PublicCatalogSnapshot } from "@/domain/types";

export const PRODUCTS_ENDPOINT = "/api/store/products";
export const PRODUCTS_REFRESH_MS = 60_000;

export type CatalogVerificationStatus = "verified" | "pending" | "unverified";

export interface PublicCatalogView {
  /** Products and categories always come from the same snapshot (never mixed across reads). */
  products: Product[];
  categories: Category[];
  verificationStatus: CatalogVerificationStatus;
  /** Increments on every successful verification, so anything derived from a past read can tell it is stale. */
  verifiedGeneration: number;
  recheckProducts: () => void;
}

/** Static demo menu, shown only when the server gave no snapshot at all (e.g. no Supabase configured). */
const FIXTURE_SNAPSHOT: PublicCatalogSnapshot = { products: fixtureProducts, categories: fixtureCategories };

export interface UsePublicCatalogOptions {
  /**
   * What the page was rendered with: the server's snapshot (possibly empty: a store with nothing
   * published), or null when the server could not read the catalog.
   */
  initialCatalog?: PublicCatalogSnapshot | null;
}

/**
 * Reads the latest published products, option configurations and categories from the server.
 * Re-reads when the tab regains visibility/focus and periodically.
 * A valid answer replaces the snapshot, empty included ("nothing published" is data, not an error).
 * A failed or malformed answer keeps the current snapshot and marks it 'unverified'; it never
 * empties the menu nor wipes cart lines.
 */
export function usePublicCatalog(options: UsePublicCatalogOptions = {}): PublicCatalogView {
  const [snapshot, setSnapshot] = useState<PublicCatalogSnapshot>(() => options.initialCatalog ?? FIXTURE_SNAPSHOT);
  const [verificationStatus, setVerificationStatus] = useState<CatalogVerificationStatus>("pending");
  const [verifiedGeneration, setVerifiedGeneration] = useState(0);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const performFetch = useCallback((controller: AbortController, reqId: number) => {
    fetch(PRODUCTS_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        // Generation check after fetch resolves
        if (reqId !== requestIdRef.current) return;
        if (!response.ok) {
          if (reqId !== requestIdRef.current) return;
          // Server error (e.g. 503, 500, 404): keep existing products, mark unverified without wiping cart
          setVerificationStatus("unverified");
          return;
        }
        try {
          const body = await response.json();
          // P1 B: Generation check after awaiting response.json() prevents old slow responses from overwriting newer ones
          if (reqId !== requestIdRef.current) return;

          const parsed = parsePublicCatalog(body);
          if (reqId !== requestIdRef.current) return;

          if (parsed) {
            // A complete answer is the truth, even an empty menu.
            setSnapshot(parsed);
            setVerificationStatus("verified");
            setVerifiedGeneration((generation) => generation + 1);
          } else {
            // Incomplete or malformed payload: keep what is shown, do not treat it as verified.
            setVerificationStatus("unverified");
          }
        } catch {
          if (reqId !== requestIdRef.current) return;
          setVerificationStatus("unverified");
        }
      })
      .catch((err: unknown) => {
        if (reqId !== requestIdRef.current) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        // Network failure (offline, timeout): keep existing products, mark unverified
        setVerificationStatus("unverified");
      });
  }, []);

  const recheckProducts = useCallback(() => {
    // P1 B: Transition verified -> pending when a refetch cycle begins
    setVerificationStatus("pending");
    const reqId = ++requestIdRef.current;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    performFetch(controller, reqId);
  }, [performFetch]);

  useEffect(() => {
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const reqId = ++requestIdRef.current;
    performFetch(controller, reqId);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recheckProducts();
      }
    };

    const onFocus = () => {
      recheckProducts();
    };

    const timer = window.setInterval(recheckProducts, PRODUCTS_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [performFetch, recheckProducts]);

  return {
    products: snapshot.products,
    categories: snapshot.categories,
    verificationStatus,
    verifiedGeneration,
    recheckProducts
  };
}
