import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeCart } from "@/domain/cart";
import type { CartLine } from "@/domain/types";
import {
  CART_STORAGE_KEY,
  getCartSnapshot,
  isStorageDegraded,
  resetCartStoreForTesting,
  setCartState,
  subscribeCart,
  subscribeStorageDegraded
} from "./cart-store";

describe("cart-store - Manejo de almacenamiento, degradación y sincronización (P2 D)", () => {
  const sampleLine: CartLine = {
    id: '{"productId":"smash-doble","notes":"","selectedOptions":{"patty":["double"]}}',
    productId: "smash-doble",
    productSlug: "smash-bunker-doble",
    productName: "Smash Búnker Doble",
    unitPriceCents: 780000n,
    quantity: 1,
    notes: "",
    selectedOptions: { patty: ["double"] }
  };

  beforeEach(() => {
    localStorage.clear();
    resetCartStoreForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    resetCartStoreForTesting();
    vi.restoreAllMocks();
  });

  it("actualiza estado y persiste normalmente cuando localStorage está disponible", () => {
    expect(getCartSnapshot()).toEqual([]);
    expect(isStorageDegraded()).toBe(false);

    setCartState([sampleLine]);

    expect(getCartSnapshot()).toEqual([sampleLine]);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(serializeCart([sampleLine]));
    expect(isStorageDegraded()).toBe(false);
  });

  it("mantiene el carrito en memoria durante la sesión ante QuotaExceededError en setItem", () => {
    let degradedNotified = false;
    const unsubscribeDegraded = subscribeStorageDegraded(() => {
      degradedNotified = true;
    });

    // Simular que setItem lanza QuotaExceededError
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const error = new DOMException("Quota exceeded", "QuotaExceededError");
      throw error;
    });

    setCartState([sampleLine]);

    // Los cambios se mantienen en sesión aunque falló el disco
    expect(getCartSnapshot()).toEqual([sampleLine]);
    expect(isStorageDegraded()).toBe(true);
    expect(degradedNotified).toBe(true);

    unsubscribeDegraded();
  });

  it("recupera la persistencia cuando una escritura posterior tiene éxito tras un fallo de cuota", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    // Primera escritura falla
    setItemSpy.mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    setCartState([sampleLine]);
    expect(isStorageDegraded()).toBe(true);

    // Segunda escritura tiene éxito (por ejemplo, tras vaciar o liberar espacio)
    setItemSpy.mockImplementationOnce((key, val) => {
      // Éxito real en storage
      Storage.prototype.setItem.call(localStorage, key, val);
    });

    const secondLine = { ...sampleLine, quantity: 2 };
    setCartState([secondLine]);

    expect(isStorageDegraded()).toBe(false);
    expect(getCartSnapshot()).toEqual([secondLine]);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(serializeCart([secondLine]));
  });

  it("maneja SecurityError en read (getItem) degradando a memoria sin lanzar excepción", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    // No debe lanzar excepción
    const snapshot = getCartSnapshot();
    expect(snapshot).toEqual([]);
    expect(isStorageDegraded()).toBe(true);
  });

  it("maneja SecurityError en write (setItem) manteniendo estado en memoria y marcando degradado", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    setCartState([sampleLine]);
    expect(getCartSnapshot()).toEqual([sampleLine]);
    expect(isStorageDegraded()).toBe(true);
  });

  it("sincroniza mediante StorageEvent y recupera el estado de degradación", () => {
    let cartUpdates = 0;
    const unsubscribe = subscribeCart(() => {
      cartUpdates++;
    });

    // Disparar evento de almacenamiento
    const serialized = serializeCart([sampleLine]);
    localStorage.setItem(CART_STORAGE_KEY, serialized);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CART_STORAGE_KEY,
        newValue: serialized
      })
    );

    expect(cartUpdates).toBe(1);
    expect(getCartSnapshot()).toEqual([sampleLine]);

    unsubscribe();
  });
});
