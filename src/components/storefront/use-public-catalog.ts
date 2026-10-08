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
  revalidateOnMount?: boolean;
}

export function usePublicCatalog(options?: Product[] | UsePublicCatalogOptions): PublicCatalogView {
  const rawInitial = Array.isArray(options) ? options : options?.initialProducts;
  const initialProducts = rawInitial && rawInitial.length > 0 ? rawInitial : staticFallbackProducts;
  const revalidateOnMount = Array.isArray(options) ? true : (options?.revalidateOnMount ?? true);
  const [products, setProducts] = useState<Product[]>(() => initialProducts);
  const [verificationStatus, setVerificationStatus] = useState<CatalogVerificationStatus>("verified");
  const inFlightRef = useRef(false);

  const load = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();

    fetch(PRODUCTS_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          // Server error: keep current products, mark unverified
          setVerificationStatus("unverified");
          return;
        }
        const body = await response.json();
        const parsed = parsePublicProducts(body);
        if (parsed && parsed.length > 0) {
          setProducts(parsed);
          setVerificationStatus("verified");
        } else {
          setVerificationStatus("unverified");
        }
      })
      .catch(() => {
        // Network failure (offline, timeout): keep current products, mark unverified
        setVerificationStatus("unverified");
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (revalidateOnMount) {
      load();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };

    const onFocus = () => {
      load();
    };

    const timer = window.setInterval(load, PRODUCTS_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, revalidateOnMount]);

  return {
    products,
    verificationStatus,
    recheckProducts: load
  };
}
