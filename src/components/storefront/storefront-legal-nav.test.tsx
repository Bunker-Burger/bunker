import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categories as fixtureCategories, products as fixtureProducts } from "@/data/catalog";
import { resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";

/*
 * BB-18: the footer links come back by flipping LEGAL_NAV_VISIBLE once the owner approves the texts.
 * The flag is only overridden here; storefront-menu.test.tsx covers the shipped value (hidden).
 */
vi.mock("@/content/legal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/content/legal")>()),
  LEGAL_NAV_VISIBLE: true
}));

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

describe("pie legal con LEGAL_NAV_VISIBLE activado", () => {
  it("enlaza términos, privacidad y cancelaciones, junto al aviso de alérgenos", () => {
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("La carta no informa alérgenos.");
    const links = within(within(footer).getByRole("navigation", { name: "Textos legales" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/legal/terminos", "/legal/privacidad", "/legal/cancelaciones"]);
  });
});
