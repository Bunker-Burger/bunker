import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categories as fixtureCategories, products as fixtureProducts } from "@/data/catalog";
import { resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";

/* BB-18: los enlaces permanecen en el HTML y se muestran quitando `hidden`. */

beforeEach(() => {
  localStorage.clear();
  resetCartStoreForTesting();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(serializePublicCatalog({ products: fixtureProducts, categories: fixtureCategories })))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pie legal con atributo hidden", () => {
  it("permanece oculto y queda visible al quitar hidden del contenedor", () => {
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("La carta no informa alérgenos.");
    const container = footer.querySelector("div[hidden]");
    expect(container).not.toBeNull();
    expect(container).not.toBeVisible();
    expect(within(footer).queryByRole("navigation", { name: "Textos legales" })).toBeNull();

    container!.removeAttribute("hidden");

    const nav = within(footer).getByRole("navigation", { name: "Textos legales" });
    expect(nav).toBeVisible();
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/legal/terminos", "/legal/privacidad", "/legal/cancelaciones"]);
  });
});
