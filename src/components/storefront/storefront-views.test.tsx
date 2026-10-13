import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fallbackProducts, categories as fixtureCategories } from "@/data/catalog";
import { resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { TOAST_DURATION_MS } from "./store-toast";
import { Storefront } from "./storefront";

/* Issue #54: one screen at a time (menu, cart, checkout) and a confirmation that goes away. */

const screenOf = (id: "menu" | "carrito" | "checkout") => document.getElementById(id) as HTMLElement;
const goTo = (hash: string) =>
  act(() => {
    window.history.pushState({}, "", `/${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

beforeEach(() => {
  localStorage.clear();
  resetCartStoreForTesting();
  window.history.replaceState({}, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/api/store/products")) {
        return Response.json(serializePublicCatalog({ products: fallbackProducts, categories: fixtureCategories }));
      }
      return new Response(null, { status: 503 });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("pantallas del storefront", () => {
  it("abre en la carta y el hash elige una sola pantalla a la vez", () => {
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    expect(screenOf("menu")).toHaveAttribute("data-active", "true");
    expect(screenOf("carrito")).toHaveAttribute("data-active", "false");
    expect(screenOf("checkout")).toHaveAttribute("data-active", "false");
    expect(screen.getByRole("link", { name: "Menú" })).toHaveAttribute("aria-current", "location");

    goTo("#checkout");
    expect(screenOf("menu")).toHaveAttribute("data-active", "false");
    expect(screenOf("checkout")).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("link", { name: "Checkout" })).toHaveAttribute("aria-current", "location");
    // The checkout title takes focus, as a page load would.
    expect(screen.getByRole("heading", { level: 2, name: "Finalizar pedido" })).toHaveFocus();
    // Back from the checkout goes to the cart.
    expect(within(screenOf("checkout")).getByRole("link", { name: "Volver al carrito" })).toHaveAttribute("href", "#carrito");

    goTo("#carrito");
    expect(screenOf("carrito")).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Tu pedido" })).toHaveFocus();

    goTo("#cualquier-cosa");
    expect(screenOf("menu")).toHaveAttribute("data-active", "true");
  });

  it("el header (logo y nombre) sólo está en la carta, sin un segundo acceso al carrito", () => {
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const brand = screen.getByRole("link", { name: "Búnker Burger, ir al menú" });
    expect(brand.querySelector("img")).toHaveAttribute("src", "/assets/bunker-logo.webp");
    expect(screen.getAllByRole("link", { name: /^Carrito, \d+ productos$/ })).toHaveLength(1);

    goTo("#checkout");
    expect(screen.queryByRole("link", { name: "Búnker Burger, ir al menú" })).toBeNull();
  });

  it("la bandeja rápida aparece sólo en la carta, con cantidad, subtotal y acceso al pedido", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));

    const tray = screen.getByRole("link", { name: /1 producto.*7\.800.*Ver pedido/ });
    expect(tray).toHaveAttribute("href", "#carrito");
    expect(screen.getByRole("link", { name: "Carrito, 1 productos" })).toBeInTheDocument();

    goTo("#carrito");
    expect(screen.queryByRole("link", { name: /Ver pedido/ })).toBeNull();
  });
});

describe("aviso de producto agregado", () => {
  it("se anuncia una vez y desaparece solo; agregar varias veces no deja avisos colgados", () => {
    vi.useFakeTimers();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const add = screen.getByRole("button", { name: "Agregar Smash Búnker Doble" });

    act(() => add.click());
    expect(screen.getByRole("status")).toHaveTextContent("Smash Búnker Doble se agregó al carrito.");
    act(() => vi.advanceTimersByTime(2000));
    act(() => add.click());
    act(() => add.click());
    expect(document.querySelectorAll(".store-toast")).toHaveLength(1);

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("link", { name: "Carrito, 3 productos" })).toBeInTheDocument();
  });

  it("se puede cerrar a mano", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
  });
});
