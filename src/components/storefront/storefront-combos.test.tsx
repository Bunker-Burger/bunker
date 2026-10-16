import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categories as fixtureCategories, products as fixtureProducts } from "@/data/catalog";
import type { PublicPromotion } from "@/domain/public-promotions";
import { getCartSnapshot, resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";

/* Combos (issue #54): a fixed-price promotion over products is added to the cart by tapping it,
 * and has a "Combos" section in the menu. */

const combo = (overrides: Partial<PublicPromotion> = {}): PublicPromotion => ({
  id: "combo-1",
  slug: "combo-oklahoma-papas",
  name: "Combo Oklahoma",
  priority: 10,
  startsAt: "2020-01-01T00:00:00.000Z",
  endsAt: "2099-01-01T00:00:00.000Z",
  mechanic: { type: "fixed_price", fixedPriceCents: "950000" },
  channels: ["delivery", "pickup"],
  items: [
    { productSlug: "oklahoma-onion", quantity: 1 },
    { productSlug: "papas-bunker", quantity: 2 }
  ],
  schedule: [],
  imageUrl: "https://cdn.test/catalog/s1/promotions/combo.jpg",
  badgeText: "COMBO",
  ...overrides
});

let promotions: PublicPromotion[];
let categories = fixtureCategories;

beforeEach(() => {
  localStorage.clear();
  resetCartStoreForTesting();
  window.history.replaceState({}, "", "/");
  promotions = [combo()];
  categories = fixtureCategories;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
      if (url.pathname === "/api/store/promotions") return Response.json({ promotions });
      return Response.json(serializePublicCatalog({ products: fixtureProducts, categories }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderStore = () => render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

const comboCategory = (overrides: Partial<(typeof fixtureCategories)[number]> = {}) => ({
  id: "combos",
  slug: "combos",
  name: "Combos",
  type: "other" as const,
  sortOrder: 25,
  visible: true,
  ...overrides
});

describe("the Combos section is a category of the menu", () => {
  it("sits where the store ordered it, between the sandwiches and the sides", async () => {
    categories = [...fixtureCategories, comboCategory()];
    renderStore();

    const combos = await screen.findByRole("region", { name: "Combos" });
    const sandwiches = screen.getByRole("region", { name: "Sándwiches" });
    const fries = screen.getByRole("region", { name: "Papas" });
    expect(sandwiches.compareDocumentPosition(combos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(combos.compareDocumentPosition(fries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("can be ordered last, and hidden with the category", async () => {
    categories = [...fixtureCategories, comboCategory({ sortOrder: 99 })];
    const { unmount } = renderStore();
    const combos = await screen.findByRole("region", { name: "Combos" });
    const drinks = screen.getByRole("region", { name: "Bebidas" });
    expect(drinks.compareDocumentPosition(combos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    categories = [...fixtureCategories, comboCategory({ visible: false })];
    renderStore();
    await screen.findByRole("region", { name: "Promociones" });
    expect(screen.queryByRole("region", { name: "Combos" })).toBeNull();
  });
});

describe("combos in the menu", () => {
  it("has a Combos section with the contents, the closed price and the normal price struck through", async () => {
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    expect(within(section).getByText("Combo Oklahoma")).toBeInTheDocument();
    expect(within(section).getByText("1× Oklahoma Onion + 2× Papas Búnker")).toBeInTheDocument();
    expect(within(section).getByText("$ 9.500")).toBeInTheDocument();
    expect(within(section).getByText("$ 14.200", { selector: "s" })).toBeInTheDocument();
  });

  it("adds the combo's products to the cart when its card is tapped", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    await waitFor(() => expect(getCartSnapshot()).toHaveLength(2));
    expect(getCartSnapshot().map((line) => [line.productId, line.quantity])).toEqual([
      ["oklahoma", 1],
      ["papas", 2]
    ]);
    expect(await screen.findByText("Combo Oklahoma se agregó al carrito.")).toBeInTheDocument();
  });

  it("shows the combo's price in the cart tray, not the sum of the products", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    const tray = await screen.findByRole("link", { name: /Ver pedido/ });
    expect(within(tray).getByText("$ 9.500")).toBeInTheDocument();
    expect(within(tray).getByText("$ 14.200", { selector: "s" })).toBeInTheDocument();
  });

  it("adds it from the promotions banner too", async () => {
    const user = userEvent.setup();
    renderStore();

    const banner = await screen.findByRole("region", { name: "Promociones" });
    await user.click(within(banner).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    await waitFor(() => expect(getCartSnapshot()).toHaveLength(2));
  });

  it("adds nothing when a product of the combo is out of stock, and says so", async () => {
    promotions = [combo({ items: [{ productSlug: "oklahoma-onion", quantity: 1 }, { productSlug: "pulled-pork-bunker", quantity: 1 }] })];
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    expect(await screen.findByText(/Pulled Pork Búnker no está disponible/)).toBeInTheDocument();
    expect(getCartSnapshot()).toHaveLength(0);
  });

  it("has no Combos section when no promotion is a combo", async () => {
    promotions = [combo({ mechanic: { type: "percent_off", percentOff: 15 } })];
    renderStore();

    await screen.findByRole("region", { name: "Promociones" });
    expect(screen.queryByRole("region", { name: "Combos" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Agregar combo/ })).toBeNull();
  });
});
