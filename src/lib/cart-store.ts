"use client";

import { useSyncExternalStore } from "react";
import { parsePersistedCart, serializeCart } from "@/domain/cart";
import type { CartLine } from "@/domain/types";

export const CART_STORAGE_KEY = "bunker-cart";
const EMPTY_CART: readonly CartLine[] = [];

type CartListener = () => void;
const listeners = new Set<CartListener>();

let cachedRaw: string | null = null;
let cachedSnapshot: CartLine[] = [];

function safeLocalStorageGet(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(CART_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function safeLocalStorageSet(value: string): boolean {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CART_STORAGE_KEY, value);
      return true;
    }
  } catch {
    // Ignore storage quota or security errors in strict private browsing
  }
  return false;
}

export function getCartSnapshot(): CartLine[] {
  if (typeof window === "undefined") return EMPTY_CART as CartLine[];
  const raw = safeLocalStorageGet();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = parsePersistedCart(raw);
  }
  return cachedSnapshot;
}

export function getServerSnapshot(): CartLine[] {
  return EMPTY_CART as CartLine[];
}

export function subscribeCart(listener: CartListener): () => void {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CART_STORAGE_KEY || event.key === null) {
      if (event.newValue === cachedRaw) return;
      cachedRaw = event.newValue;
      cachedSnapshot = parsePersistedCart(event.newValue);
      listeners.forEach((l) => l());
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function setCartState(next: CartLine[] | ((current: CartLine[]) => CartLine[])): void {
  const current = getCartSnapshot();
  const nextLines = typeof next === "function" ? next(current) : next;
  const serialized = serializeCart(nextLines);

  cachedRaw = serialized;
  cachedSnapshot = nextLines;
  safeLocalStorageSet(serialized);

  listeners.forEach((l) => l());
}

export function useCart(): [CartLine[], (next: CartLine[] | ((current: CartLine[]) => CartLine[])) => void] {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerSnapshot);
  return [cart, setCartState];
}
