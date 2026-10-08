"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { products as staticFallbackProducts } from "@/data/catalog";
import { parsePublicProducts } from "@/domain/public-products";
import type { Product } from "@/domain/types";

export const PRODUCTS_ENDPOINT = "/api/store/products";
export const PRODUCTS_REFRESH_MS = 60_000;

export type CatalogVerificationStatus = "verified" | "pending" | "unverified";

export interface PublicCatalogView {
  products: Product[];
  verificationStatus: CatalogVerificationStatus;
  recheckProducts: () => void;
}

/**
 * Reads the latest published products and option configurations from the server.
 * Re-reads when the tab regains visibility/focus and periodically.
 * If the network fails or endpoint is unavailable, preserves existing products,
 * marks verificationStatus as 'unverified', never wiping lines.
 */
export interface UsePublicCatalogOptions {
  initialProducts?: Product[];
}

export function usePublicCatalog(options?: Product[] | UsePublicCatalogOptions): PublicCatalogView {
  const rawInitial = Array.isArray(options) ? options : options?.initialProducts;
  const initialProducts = rawInitial && rawInitial.length > 0 ? rawInitial : staticFallbackProducts;
  const [products, setProducts] = useState<Product[]>(() => initialProducts);
  const [verificationStatus, setVerificationStatus] = useState<CatalogVerificationStatus>("pending");
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

          const parsed = parsePublicProducts(body);
          if (reqId !== requestIdRef.current) return;

          if (parsed && parsed.length > 0) {
            setProducts(parsed);
            setVerificationStatus("verified");
          } else {
            // Unconfirmed, incomplete or empty payload: do not treat as verified
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
    products,
    verificationStatus,
    recheckProducts
  };
}
