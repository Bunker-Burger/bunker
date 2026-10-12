import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLERGEN_NOTICE } from "@/content/legal";
import { products as fallbackProducts, categories as fixtureCategories } from "@/data/catalog";
import type { Category } from "@/domain/types";
import { resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";

/* BB-07: public menu (sections, search, filters) and the product drawer's accessibility. */

const menu = () => within(document.getElementById("menu") as HTMLElement);
const sectionTitles = () => menu().getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
const renderStorefront = (props: Partial<Parameters<typeof Storefront>[0]> = {}) =>
  render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} {...props} />);

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
      throw new Error(`Unexpected fetch call: ${url}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("carta pública", () => {
  it("muestra destacadas y después cada sección, sin repetir productos", () => {
    renderStorefront();

    expect(sectionTitles()).toEqual(["Las más pedidas", "Sándwiches", "Papas", "Bebidas"]);
    for (const name of ["Smash Búnker Doble", "Crispy Chicken Búnker", "Papas Búnker", "Limonada de la Casa"]) {
      expect(menu().getAllByRole("heading", { level: 3, name })).toHaveLength(1);
    }
  });

  it("respeta el orden y los nombres de categorías configurados por el local", () => {
    const categories: Category[] = [
      { id: "drinks", slug: "bebidas", name: "Bebidas", type: "beverage", sortOrder: 1, visible: true },
      { id: "fries", slug: "papas", name: "Acompañamientos", type: "fries", sortOrder: 2, visible: true },
      { id: "burgers", slug: "hamburguesas", name: "Clásicas", type: "burger", sortOrder: 3, visible: true },
      { id: "sandwiches", slug: "sandwiches", name: "Sándwiches", type: "sandwich", sortOrder: 4, visible: true }
    ];
    renderStorefront({ initialCatalog: { products: fallbackProducts, categories } });

    expect(sectionTitles()).toEqual(["Las más pedidas", "Bebidas", "Acompañamientos", "Sándwiches"]);
    // No section filters (owner's call on issue #54): the search in the header narrows the menu.
    expect(screen.queryByRole("group", { name: "Secciones de la carta" })).toBeNull();
  });

  it("busca por nombre o descripción y ofrece volver a la carta cuando no hay resultados", async () => {
    const user = userEvent.setup();
    renderStorefront();
    await user.click(screen.getByRole("button", { name: "Buscar en la carta" }));
    const search = screen.getByRole("searchbox", { name: "Buscar en la carta" });
    expect(search).toHaveFocus();

    await user.type(search, "CEBOLLA");
    expect(menu().getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Oklahoma Onion", "Aros de Cebolla"]);
    expect(screen.getByText("Mostrando 2 productos.")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "pizza");
    expect(screen.getByRole("heading", { name: "No encontramos productos" })).toBeInTheDocument();
    expect(screen.getByText("Nada coincide con “pizza”.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ver toda la carta" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(sectionTitles()).toHaveLength(4);

    // Escape closes the search, clears it and gives focus back to the magnifier.
    await user.click(screen.getByRole("button", { name: "Buscar en la carta" }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar en la carta" }), "papas{Escape}");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Buscar en la carta" })).toHaveFocus();
    expect(sectionTitles()).toHaveLength(4);
  });

  it("anuncia precio y stock de cada tarjeta, y un agotado no se puede agregar", async () => {
    const user = userEvent.setup();
    renderStorefront();

    const available = screen.getByRole("button", { name: "Ver Smash Búnker Doble" });
    expect(available).toHaveAccessibleDescription(/^Precio \$\s?7\.800 Disponible\. Dos medallones/);

    const soldOut = screen.getByRole("button", { name: "Ver Pulled Pork Búnker" });
    expect(soldOut).toHaveAccessibleDescription(/^Precio \$\s?7\.400 Agotado, no se puede pedir\./);
    const addSoldOut = screen.getByRole("button", { name: "Pulled Pork Búnker agotado" });
    expect(addSoldOut).toBeDisabled();
    await user.click(addSoldOut);
    expect(localStorage.getItem("bunker-cart") ?? "").not.toContain("pulled-pork");
  });
});

describe("sin carta leída y sin menú demo (BB-18)", () => {
  it("no inventa productos: avisa que no pudo cargar y muestra la carta real cuando el servidor responde", async () => {
    renderStorefront({ catalogFallback: "empty" });

    expect(menu().getByRole("heading", { level: 2, name: "No pudimos cargar la carta" })).toBeTruthy();
    expect(menu().queryByRole("heading", { level: 3 })).toBeNull();
    expect(await menu().findByRole("heading", { level: 3, name: "Smash Búnker Doble" })).toBeTruthy();
    expect(menu().queryByText("No pudimos cargar la carta")).toBeNull();
  });

  it("si el servidor tampoco responde, sigue sin productos y no dice que la carta está vacía", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    renderStorefront({ catalogFallback: "empty" });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(menu().getByText("No pudimos cargar la carta")).toBeTruthy();
    expect(menu().queryByText("La carta está vacía por ahora")).toBeNull();
    expect(menu().queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("una carta real vacía sigue diciendo que el local no publicó productos", () => {
    renderStorefront({ catalogFallback: "empty", initialCatalog: { products: [], categories: fixtureCategories } });

    expect(menu().getByText("La carta está vacía por ahora")).toBeTruthy();
  });
});

describe("pie legal (BB-18)", () => {
  it("avisa que la carta no informa alérgenos y, con los textos en revisión, no enlaza las páginas legales", () => {
    renderStorefront();

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(ALLERGEN_NOTICE);
    const hiddenContainer = footer.querySelector("div[hidden]");
    expect(hiddenContainer).not.toBeNull();
    expect(hiddenContainer).not.toBeVisible();
    expect(within(footer).queryByRole("navigation", { name: "Textos legales" })).toBeNull();
    expect(within(footer).queryAllByRole("link")).toEqual([]);
    expect([...footer.querySelectorAll('a[href^="/legal/"]')].map((link) => link.getAttribute("href"))).toEqual([
      "/legal/terminos", "/legal/privacidad", "/legal/cancelaciones"
    ]);
  });
});

describe("drawer de producto", () => {
  it("la tarjeta abre /?producto=<slug>; Escape cierra, limpia la URL y devuelve el foco a la tarjeta", async () => {
    const user = userEvent.setup();
    renderStorefront();
    const trigger = screen.getByRole("button", { name: "Ver Oklahoma Onion" });

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Personalizar Oklahoma Onion" });
    expect(new URL(window.location.href).searchParams.get("producto")).toBe("oklahoma-onion");
    expect(dialog).toHaveAccessibleDescription(/^Precio \$\s?7\.200\. Disponible\.$/);
    expect(within(dialog).getByRole("button", { name: "Seguir pidiendo" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.has("producto")).toBe(false);
    expect(trigger).toHaveFocus();
  });

  it("Atrás del navegador cierra el drawer y devuelve el foco a la tarjeta", async () => {
    const user = userEvent.setup();
    renderStorefront();
    const trigger = screen.getByRole("button", { name: "Ver Crispy Chicken Búnker" });

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Personalizar Crispy Chicken Búnker" })).toBeInTheDocument();

    window.history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("agregar desde el drawer cierra y devuelve el foco a la tarjeta", async () => {
    const user = userEvent.setup();
    renderStorefront();
    const trigger = screen.getByRole("button", { name: "Ver Papas Búnker" });

    await user.click(trigger);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Agregar 1 al carrito/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
  });

  it("mantiene el foco del teclado dentro del drawer (Tab y Shift+Tab)", async () => {
    const user = userEvent.setup();
    renderStorefront({ initialProductSlug: "gaseosa-lata" });
    const dialog = screen.getByRole("dialog", { name: "Personalizar Gaseosa Lata 354ml" });
    const close = within(dialog).getByRole("button", { name: "Seguir pidiendo" });
    const submit = within(dialog).getByRole("button", { name: /Agregar 1 al carrito/ });

    expect(close).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(submit).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    for (let step = 0; step < 12; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("un link compartido abre el producto y al cerrar el foco va a su tarjeta", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?producto=limonada-de-la-casa");
    renderStorefront({ initialProductSlug: "limonada-de-la-casa" });

    await user.click(within(screen.getByRole("dialog", { name: "Personalizar Limonada de la Casa" })).getByRole("button", { name: "Seguir pidiendo" }));

    expect(screen.getByRole("button", { name: "Ver Limonada de la Casa" })).toHaveFocus();
    expect(window.location.search).toBe("");
  });

  it("un producto agotado se puede ver pero no agregar desde el drawer", async () => {
    const user = userEvent.setup();
    renderStorefront({ initialProductSlug: "pulled-pork-bunker" });
    const dialog = screen.getByRole("dialog", { name: "Personalizar Pulled Pork Búnker" });

    expect(dialog).toHaveAccessibleDescription(/Agotado, no se puede agregar al carrito\.$/);
    const submit = within(dialog).getByRole("button", { name: "Producto agotado" });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(localStorage.getItem("bunker-cart") ?? "").not.toContain("pulled-pork");
  });
});
