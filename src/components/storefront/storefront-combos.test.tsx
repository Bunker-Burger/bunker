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
  description: "Dos hamburguesas bien cargadas con papas para compartir.",
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
    // The card shows the store's description; the quantities of each product are in the detail.
    expect(within(section).getByText("Dos hamburguesas bien cargadas con papas para compartir.")).toBeInTheDocument();
    expect(within(section).queryByText(/1× Oklahoma/)).toBeNull();
    expect(within(section).getByText("$ 9.500")).toBeInTheDocument();
    expect(within(section).getByText("$ 14.200", { selector: "s" })).toBeInTheDocument();
  });

  it("opens the combo's detail when its card is tapped: description, contents and price, adding nothing yet", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    const detail = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    expect(within(detail).getByText("Dos hamburguesas bien cargadas con papas para compartir.")).toBeInTheDocument();
    expect(within(detail).getByText("Incluye")).toBeInTheDocument();
    expect(within(detail).getByText(/Oklahoma Onion/, { selector: "li" })).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: /Agregar combo/ })).toHaveTextContent("$ 9.500");
    expect(getCartSnapshot()).toHaveLength(0);
  });

  it("adds the combo's products to the cart from its detail", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    const detail = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    await user.click(within(detail).getByRole("button", { name: /Agregar combo/ }));

    await waitFor(() => expect(getCartSnapshot()).toHaveLength(2));
    expect(getCartSnapshot().map((line) => [line.productId, line.quantity])).toEqual([
      ["oklahoma", 1],
      ["papas", 2]
    ]);
    expect(await screen.findByText("Combo Oklahoma se agregó al carrito.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Combo Oklahoma" })).toBeNull();
  });

  it("lets the extras of the combo's products be chosen, and adds them on top of the combo's price", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    const detail = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    const burger = within(within(detail).getByRole("region", { name: "Opciones de Oklahoma Onion" }));
    await user.click(burger.getByRole("checkbox", { name: /Extra bacon ahumado/ }));

    expect(within(within(detail).getByRole("region", { name: "Resumen del combo" })).getByText("+ $ 900")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: /Agregar combo/ })).toHaveTextContent("$ 10.400");
    await user.click(within(detail).getByRole("button", { name: /Agregar combo/ }));

    const burgerLine = getCartSnapshot().find((line) => line.productId === "oklahoma");
    expect(burgerLine?.selectedOptions.extras).toEqual(["bacon"]);
    expect(getCartSnapshot().find((line) => line.productId === "papas")?.quantity).toBe(2);
  });

  it("with two different products, each one has its own extras, apart in the detail and in the summary", async () => {
    promotions = [combo({ items: [{ productSlug: "oklahoma-onion", quantity: 1 }, { productSlug: "crispy-chicken-bunker", quantity: 1 }] })];
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    const detail = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    const burger = within(within(detail).getByRole("region", { name: "Opciones de Oklahoma Onion" }));
    const chicken = within(within(detail).getByRole("region", { name: "Opciones de Crispy Chicken Búnker" }));
    expect(within(detail).getByRole("heading", { name: "1× Oklahoma Onion" })).toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "1× Crispy Chicken Búnker" })).toBeInTheDocument();

    // Choosing the bread of one does not touch the other's: separate inputs.
    await user.click(chicken.getByRole("radio", { name: /Pan de papa/ }));
    expect(chicken.getByRole("radio", { name: /Pan de papa/ })).toBeChecked();
    expect(burger.getByRole("radio", { name: /Doble/ })).toBeChecked();
    await user.click(burger.getByRole("checkbox", { name: /Extra bacon ahumado/ }));

    const summary = within(within(detail).getByRole("region", { name: "Resumen del combo" }));
    expect(summary.getByText("Oklahoma Onion")).toBeInTheDocument();
    expect(summary.getByText("+ Extra bacon ahumado")).toBeInTheDocument();
    expect(summary.queryByText("Crispy Chicken Búnker")).toBeNull();
  });

  it("shows the combo's price in the cart tray, not the sum of the products", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Combo Oklahoma" })).getByRole("button", { name: /Agregar combo/ }));

    const tray = await screen.findByRole("link", { name: /Ver pedido/ });
    expect(within(tray).getByText("$ 9.500")).toBeInTheDocument();
    expect(within(tray).getByText("$ 14.200", { selector: "s" })).toBeInTheDocument();
  });

  it("shows the promotion applied in the cart screen, with the total after it", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Combo Oklahoma" })).getByRole("button", { name: /Agregar combo/ }));

    const cart = within(document.getElementById("carrito") as HTMLElement);
    expect(await cart.findByText("Promo aplicada")).toBeInTheDocument();
    expect(cart.getByText("− $ 4.700")).toBeInTheDocument();
    const total = cart.getByText("Subtotal con promo").nextElementSibling;
    expect(total).toHaveTextContent("$ 9.500");
  });

  it("in the cart a combo is one unit: + adds another combo, − takes one away", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Combo Oklahoma" })).getByRole("button", { name: /Agregar combo/ }));

    const cart = within(document.getElementById("carrito") as HTMLElement);
    expect(cart.getByText("1 combo")).toBeInTheDocument();

    await user.click(cart.getByRole("button", { name: "Agregar otro Combo Oklahoma" }));
    expect(cart.getByText("2 combos")).toBeInTheDocument();
    expect(getCartSnapshot().map((line) => [line.productId, line.quantity])).toEqual([
      ["oklahoma", 2],
      ["papas", 4]
    ]);
    // Two combos: the combo price twice, 2 × $ 4.700 off.
    expect(cart.getByText("− $ 9.400")).toBeInTheDocument();

    await user.click(cart.getByRole("button", { name: "Quitar un Combo Oklahoma" }));
    expect(cart.getByText("1 combo")).toBeInTheDocument();
    expect(getCartSnapshot().map((line) => [line.productId, line.quantity])).toEqual([
      ["oklahoma", 1],
      ["papas", 2]
    ]);

    await user.click(cart.getByRole("button", { name: "Quitar un Combo Oklahoma" }));
    expect(getCartSnapshot()).toHaveLength(0);
  });

  it("edits a combo of the cart as a whole in its detail, with what was already chosen", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    const first = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    await user.click(within(within(first).getByRole("region", { name: "Opciones de Oklahoma Onion" })).getByRole("checkbox", { name: /Extra bacon ahumado/ }));
    await user.click(within(first).getByRole("button", { name: /Agregar combo/ }));

    const cart = within(document.getElementById("carrito") as HTMLElement);
    // The combo has one Edit; its products are not edited one by one.
    expect(cart.queryByRole("button", { name: "Editar Oklahoma Onion" })).toBeNull();
    await user.click(cart.getByRole("button", { name: "Editar Combo Oklahoma" }));

    const edit = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    const burger = within(within(edit).getByRole("region", { name: "Opciones de Oklahoma Onion" }));
    expect(burger.getByRole("checkbox", { name: /Extra bacon ahumado/ })).toBeChecked();
    expect(within(edit).getByRole("button", { name: /Guardar cambios/ })).toHaveTextContent("$ 10.400");

    await user.click(burger.getByRole("checkbox", { name: /Extra bacon ahumado/ }));
    await user.click(within(edit).getByRole("button", { name: /Guardar cambios/ }));

    expect(screen.queryByRole("dialog", { name: "Combo Oklahoma" })).toBeNull();
    expect(getCartSnapshot().find((line) => line.productId === "oklahoma")?.selectedOptions.extras ?? []).toEqual([]);
    expect(cart.getByText("1 combo")).toBeInTheDocument();
    expect(cart.getByText("Promo aplicada")).toBeInTheDocument();
  });

  it("edits several combos together: each product's quantity is the combo's times how many there are", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Combo Oklahoma" })).getByRole("button", { name: /Agregar combo/ }));
    const cart = within(document.getElementById("carrito") as HTMLElement);
    await user.click(cart.getByRole("button", { name: "Agregar otro Combo Oklahoma" }));
    await user.click(cart.getByRole("button", { name: "Editar Combo Oklahoma" }));

    const edit = await screen.findByRole("dialog", { name: /Combo Oklahoma/ });
    expect(within(edit).getByText(/2 combos/)).toBeInTheDocument();
    const burger = within(within(edit).getByRole("region", { name: "Opciones de Oklahoma Onion" }));
    await user.click(burger.getByRole("checkbox", { name: /Extra bacon ahumado/ }));
    // Two burgers: the extra can go on one or both.
    await user.click(burger.getByRole("button", { name: "Quitar Extra bacon ahumado de una unidad" }));
    await user.click(within(edit).getByRole("button", { name: /Guardar cambios/ }));

    expect(getCartSnapshot().map((line) => [line.productId, line.quantity, line.selectedOptions.extras ?? []])).toEqual([
      ["oklahoma", 1, ["bacon"]],
      ["oklahoma", 1, []],
      ["papas", 4, []]
    ]);
    expect(cart.getByText("2 combos")).toBeInTheDocument();
  });

  it("only applies the combo's price to what was added from the combo, not to the same products ordered alone", async () => {
    const user = userEvent.setup();
    renderStore();

    await screen.findByRole("region", { name: "Combos" });
    await user.click(screen.getByRole("button", { name: "Agregar Oklahoma Onion" }));
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));

    const cart = within(document.getElementById("carrito") as HTMLElement);
    expect(cart.queryByText("Promo aplicada")).toBeNull();
    const tray = await screen.findByRole("link", { name: /Ver pedido/ });
    expect(within(tray).getByText("$ 14.200")).toBeInTheDocument();
    expect(within(tray).queryByText("$ 14.200", { selector: "s" })).toBeNull();
  });

  it("opens it from the promotions banner too", async () => {
    const user = userEvent.setup();
    renderStore();

    const banner = await screen.findByRole("region", { name: "Promociones" });
    await user.click(within(banner).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    expect(await screen.findByRole("dialog", { name: "Combo Oklahoma" })).toBeInTheDocument();
  });

  it("cannot be added while a product of the combo is out of stock, and says so", async () => {
    promotions = [combo({ items: [{ productSlug: "oklahoma-onion", quantity: 1 }, { productSlug: "pulled-pork-bunker", quantity: 1 }] })];
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));

    const detail = await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    expect(within(detail).getByText(/Pulled Pork Búnker no está disponible/)).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Combo no disponible" })).toBeDisabled();
    expect(getCartSnapshot()).toHaveLength(0);
  });

  it("closes with Escape without adding anything", async () => {
    const user = userEvent.setup();
    renderStore();

    const section = await screen.findByRole("region", { name: "Combos" });
    await user.click(within(section).getByRole("button", { name: "Agregar combo Combo Oklahoma al carrito" }));
    await screen.findByRole("dialog", { name: "Combo Oklahoma" });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Combo Oklahoma" })).toBeNull();
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
