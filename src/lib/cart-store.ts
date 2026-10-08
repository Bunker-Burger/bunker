"use client";

import { useSyncExternalStore } from "react";
import { parsePersistedCart, serializeCart } from "@/domain/cart";
import type { CartLine } from "@/domain/types";

export const CART_STORAGE_KEY = "bunker-cart";
const EMPTY_CART: readonly CartLine[] = [];

type CartListener = () => void;
const listeners = new Set<CartListener>();
const storageDegradedListeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedSnapshot: CartLine[] = [];
let storageDegraded = false;

function notifyDegradedChange() {
  storageDegradedListeners.forEach((l) => l());
}

function safeLocalStorageGet(): { ok: true; value: string | null } | { ok: false } {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return { ok: true, value: window.localStorage.getItem(CART_STORAGE_KEY) };
    }
  } catch {
    // SecurityError in restricted iframe or private browsing
  }
  return { ok: false };
}

function safeLocalStorageSet(value: string): boolean {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(CART_STORAGE_KEY, value);
      return true;
    }
  } catch {
    // QuotaExceededError or SecurityError
  }
  return false;
}

export function isStorageDegraded(): boolean {
  return storageDegraded;
}

export function getStorageDegradedSnapshot(): boolean {
  return storageDegraded;
}

export function subscribeStorageDegraded(listener: () => void): () => void {
  storageDegradedListeners.add(listener);
  return () => {
    storageDegradedListeners.delete(listener);
  };
}

export function useStorageDegraded(): boolean {
  return useSyncExternalStore(subscribeStorageDegraded, getStorageDegradedSnapshot, () => false);
}

export function getCartSnapshot(): CartLine[] {
  if (typeof window === "undefined") return EMPTY_CART as CartLine[];

  if (storageDegraded) {
    return cachedSnapshot;
  }

  const result = safeLocalStorageGet();
  if (!result.ok) {
    if (!storageDegraded) {
      storageDegraded = true;
      notifyDegradedChange();
    }
    return cachedSnapshot;
  }

  const raw = result.value;
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
      if (storageDegraded) {
        storageDegraded = false;
        notifyDegradedChange();
      }
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

  // Keep in-memory state during the session regardless of storage failure
  cachedSnapshot = nextLines;

  const writeOk = safeLocalStorageSet(serialized);
  if (writeOk) {
    cachedRaw = serialized;
    if (storageDegraded) {
      storageDegraded = false;
      notifyDegradedChange();
    }
  } else {
    // Write failed (quota exceeded or security error)
    // Coherency: cachedRaw does NOT match serialized because setItem failed.
    if (!storageDegraded) {
      storageDegraded = true;
      notifyDegradedChange();
    }
  }

  listeners.forEach((l) => l());
}

export function useCart(): [CartLine[], (next: CartLine[] | ((current: CartLine[]) => CartLine[])) => void] {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerSnapshot);
  return [cart, setCartState];
}

let revalidationNotice = "";
const revalidationNoticeListeners = new Set<() => void>();

export function setRevalidationNotice(notice: string): void {
  revalidationNotice = notice;
  revalidationNoticeListeners.forEach((l) => l());
}

export function useRevalidationNotice(): [string, (notice: string) => void] {
  const notice = useSyncExternalStore(
    (l) => {
      revalidationNoticeListeners.add(l);
      return () => {
        revalidationNoticeListeners.delete(l);
      };
    },
    () => revalidationNotice,
    () => ""
  );
  return [notice, setRevalidationNotice];
}

export function resetCartStoreForTesting(): void {
  cachedRaw = null;
  cachedSnapshot = [];
  storageDegraded = false;
  revalidationNotice = "";
  listeners.clear();
  storageDegradedListeners.clear();
  revalidationNoticeListeners.clear();
}
