import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categories as fixtureCategories, products as fallbackProducts } from "@/data/catalog";
import type { Category, Product, PublicCatalogSnapshot } from "@/domain/types";
import { resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";

/*
 * BB-07 review 1: the menu follows the server's snapshot (products + categories of one read).
 * An empty verified menu is data, a failed read is not; a shared product link is only judged
 * against a verified read.
 */

const FIXTURE: PublicCatalogSnapshot = { products: fallbackProducts, categories: fixtureCategories };
const EMPTY: PublicCatalogSnapshot = { products: [], categories: [] };

/** What GET /api/store/products answers next; tests swap it (fresh data, errors, a delayed reply). */
let answerProducts: () => Response | Promise<Response>;
const serve = (snapshot: PublicCatalogSnapshot) => () => Response.json(serializePublicCatalog(snapshot));
const unavailable = () => Response.json({ error: "unavailable" }, { status: 503 });

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

/** The catalog is re-read when the window regains focus (as on a real tab switch). */
const refetchCatalog = () => act(() => window.dispatchEvent(new Event("focus")));
const productReads = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/api/store/products")).length;

const menu = () => within(document.getElementById("menu") as HTMLElement);
const sectionTitles = () => menu().queryAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
const chipLabels = () =>
  within(screen.getByRole("group", { name: "Secciones de la carta" })).getAllByRole("button").map((chip) => chip.textContent);
const renderStorefront = (props: Partial<Parameters<typeof Storefront>[0]> = {}) =>
  render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} {...props} />);

const burger = fallbackProducts.find((product) => product.id === "smash-doble")!;
const productIn = (categoryId: string, id: string, name: string): Product => ({ ...burger, id, slug: id, name, featured: false, categoryId });
const burgerCategory = (id: string, name: string, sortOrder: number): Category => ({ id, slug: id, name, type: "burger", sortOrder, visible: true });

beforeEach(() => {
  localStorage.clear();
  resetCartStoreForTesting();
  window.history.replaceState({}, "", "/");
  answerProducts = serve(FIXTURE);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/api/store/products")) return answerProducts();
      throw new Error(`Unexpected fetch call: ${url}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("carta vacía (P1 A)", () => {
  const expectEmptyMenu = () => {
    expect(menu().getByRole("heading", { name: "La carta está vacía por ahora" })).toBeInTheDocument();
    expect(menu().queryAllByRole("article")).toEqual([]);
    expect(menu().queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  };

  it("SSR vacío y respuesta 200 [] muestran la carta vacía, sin productos de ejemplo", async () => {
    answerProducts = serve(EMPTY);
    renderStorefront({ initialCatalog: EMPTY });

    expectEmptyMenu();
    await waitFor(() => expect(productReads()).toBe(1));
    // Verified: no "pending/unverified" warning, and still nothing invented.
    await waitFor(() => expect(screen.queryByTestId("verification-status-note")).not.toBeInTheDocument());
    expectEmptyMenu();
  });

  it("si el SSR no pudo leer (respaldo de ejemplo), una respuesta 200 [] verificada vacía la carta", async () => {
    answerProducts = serve(EMPTY);
    renderStorefront({ initialCatalog: null });

    expect(menu().getByRole("button", { name: "Ver Smash Búnker Doble" })).toBeInTheDocument();
    await waitFor(expectEmptyMenu);
  });

  it("un 200 [] verificado después de una carta con productos la vacía y retira esos productos del carrito", async () => {
    const user = userEvent.setup();
    renderStorefront({ initialCatalog: FIXTURE });
    await waitFor(() => expect(productReads()).toBe(1));
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();

    answerProducts = serve(EMPTY);
    await refetchCatalog();

    await waitFor(expectEmptyMenu);
    expect(screen.getByLabelText("Carrito, 0 productos")).toBeInTheDocument();
  });

  it("un 503 no vacía la carta ni el carrito: queda pendiente de verificar", async () => {
    const user = userEvent.setup();
    renderStorefront({ initialCatalog: FIXTURE });
    await waitFor(() => expect(productReads()).toBe(1));
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));

    answerProducts = unavailable;
    await refetchCatalog();

    expect(await screen.findByTestId("verification-status-note")).toHaveTextContent("Pendiente de verificar");
    expect(sectionTitles()).toEqual(["Las más pedidas", "Sándwiches", "Papas", "Bebidas"]);
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "La carta está vacía por ahora" })).not.toBeInTheDocument();
  });

  it("un 503 con SSR vacío no inventa productos: sigue vacía y pendiente", async () => {
    answerProducts = unavailable;
    renderStorefront({ initialCatalog: EMPTY });

    expect(await screen.findByTestId("verification-status-note")).toHaveTextContent("Pendiente de verificar");
    expectEmptyMenu();
  });

  it("un payload sin categorías no se toma por carta vacía", async () => {
    answerProducts = () => Response.json({ products: [] });
    renderStorefront({ initialCatalog: FIXTURE });

    expect(await screen.findByTestId("verification-status-note")).toHaveTextContent("Pendiente de verificar");
    expect(menu().getAllByRole("article").length).toBeGreaterThan(0);
  });
});

describe("link compartido /?producto=<slug> (P1 B)", () => {
  const fresh = productIn("burgers", "nueva-del-dia", "Nueva del Día");

  it("un producto que el SSR no conocía conserva la URL y abre el drawer cuando llega el catálogo fresco", async () => {
    const reply = deferred();
    answerProducts = () => reply.promise;
    const onInvalidProduct = vi.fn();
    window.history.replaceState({}, "", "/?producto=nueva-del-dia");
    renderStorefront({ initialProductSlug: "nueva-del-dia", initialCatalog: FIXTURE, onInvalidProduct });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Buscando el producto en la carta…");
    expect(window.location.search).toBe("?producto=nueva-del-dia");

    await act(async () => reply.resolve(Response.json(serializePublicCatalog({ products: [...fallbackProducts, fresh], categories: fixtureCategories }))));

    expect(await screen.findByRole("dialog", { name: "Personalizar Nueva del Día" })).toBeInTheDocument();
    expect(window.location.search).toBe("?producto=nueva-del-dia");
    expect(onInvalidProduct).not.toHaveBeenCalled();
  });

  it("si la lectura falla (503) conserva la URL y no declara el producto inexistente; la próxima lectura lo abre", async () => {
    answerProducts = unavailable;
    const onInvalidProduct = vi.fn();
    window.history.replaceState({}, "", "/?producto=nueva-del-dia");
    renderStorefront({ initialProductSlug: "nueva-del-dia", initialCatalog: FIXTURE, onInvalidProduct });

    expect(await screen.findByText("No pudimos confirmar ese producto con el local todavía. Reintentamos en un momento.")).toBeInTheDocument();
    expect(window.location.search).toBe("?producto=nueva-del-dia");
    expect(screen.queryByText("Ese producto ya no está disponible.")).not.toBeInTheDocument();
    expect(onInvalidProduct).not.toHaveBeenCalled();

    answerProducts = serve({ products: [...fallbackProducts, fresh], categories: fixtureCategories });
    await refetchCatalog();
    expect(await screen.findByRole("dialog", { name: "Personalizar Nueva del Día" })).toBeInTheDocument();
  });

  it("un 200 sin el producto limpia la URL y avisa, recién después de verificar", async () => {
    const reply = deferred();
    answerProducts = () => reply.promise;
    const onInvalidProduct = vi.fn();
    window.history.replaceState({}, "", "/?producto=no-existe");
    renderStorefront({ initialProductSlug: "no-existe", initialCatalog: FIXTURE, onInvalidProduct });

    expect(window.location.search).toBe("?producto=no-existe");
    expect(onInvalidProduct).not.toHaveBeenCalled();

    await act(async () => reply.resolve(Response.json(serializePublicCatalog(FIXTURE))));

    expect(await screen.findByText("Ese producto ya no está disponible.")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(onInvalidProduct).toHaveBeenCalledOnce();
  });

  it("un producto del respaldo que el local ya no publica se cierra al verificar, limpia la URL y avisa", async () => {
    const reply = deferred();
    answerProducts = () => reply.promise;
    window.history.replaceState({}, "", "/?producto=oklahoma-onion");
    renderStorefront({ initialProductSlug: "oklahoma-onion", initialCatalog: null });

    expect(screen.getByRole("dialog", { name: "Personalizar Oklahoma Onion" })).toBeInTheDocument();

    const withoutOklahoma = fallbackProducts.filter((product) => product.slug !== "oklahoma-onion");
    await act(async () => reply.resolve(Response.json(serializePublicCatalog({ products: withoutOklahoma, categories: fixtureCategories }))));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Ese producto ya no está disponible.")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("button", { name: "Ver Oklahoma Onion" })).not.toBeInTheDocument();
  });

  it("Atrás y Adelante cierran y reabren el producto, con el foco de vuelta en la tarjeta", async () => {
    const user = userEvent.setup();
    renderStorefront({ initialCatalog: FIXTURE });
    await waitFor(() => expect(productReads()).toBe(1));
    const trigger = screen.getByRole("button", { name: "Ver Papas Búnker" });

    await user.click(trigger);
    window.history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    window.history.forward();
    expect(await screen.findByRole("dialog", { name: "Personalizar Papas Búnker" })).toBeInTheDocument();
  });
});

describe("categorías en vivo (P2 C)", () => {
  const products = [productIn("c-clasicas", "clasica", "Clásica"), productIn("c-especiales", "especial", "Especial")];
  const initial = { products, categories: [burgerCategory("c-clasicas", "Clásicas", 10), burgerCategory("c-especiales", "Especiales", 20)] };

  it("un refetch aplica nombres, orden, categorías y productos nuevos del mismo snapshot", async () => {
    answerProducts = serve(initial);
    renderStorefront({ initialCatalog: initial });
    await waitFor(() => expect(productReads()).toBe(1));
    expect(sectionTitles()).toEqual(["Clásicas", "Especiales"]);

    // Two categories of the same type: reordered and renamed, plus a new one with a new product.
    answerProducts = serve({
      products: [...products, productIn("c-veggie", "veggie", "Veggie Búnker")],
      categories: [burgerCategory("c-especiales", "De la casa", 5), burgerCategory("c-clasicas", "Clásicas", 10), burgerCategory("c-veggie", "Veggie", 15)]
    });
    await refetchCatalog();

    await waitFor(() => expect(sectionTitles()).toEqual(["De la casa", "Clásicas", "Veggie"]));
    expect(chipLabels()).toEqual(["Todo", "De la casa", "Clásicas", "Veggie"]);
    expect(within(menu().getByRole("region", { name: "De la casa" })).getByRole("heading", { level: 3 })).toHaveTextContent("Especial");
    expect(within(menu().getByRole("region", { name: "Veggie" })).getByRole("heading", { level: 3 })).toHaveTextContent("Veggie Búnker");
  });

  it("una categoría que el local oculta desaparece con sus productos, y su filtro vuelve a Todo", async () => {
    const user = userEvent.setup();
    answerProducts = serve(initial);
    renderStorefront({ initialCatalog: initial });
    await waitFor(() => expect(productReads()).toBe(1));
    await user.click(screen.getByRole("button", { name: "Especiales" }));
    expect(sectionTitles()).toEqual(["Especiales"]);

    // The server stops publishing a hidden category and its products (loadPublicCatalog).
    answerProducts = serve({ products: [products[0]!], categories: [burgerCategory("c-clasicas", "Clásicas", 10)] });
    await refetchCatalog();

    await waitFor(() => expect(sectionTitles()).toEqual(["Clásicas"]));
    expect(chipLabels()).toEqual(["Todo", "Clásicas"]);
    expect(screen.getByRole("button", { name: "Todo" })).toHaveAttribute("aria-pressed", "true");
  });

  it("un producto cuya categoría no viene en el snapshot no se mueve a otra del mismo tipo", async () => {
    const snapshot = {
      products: [...products, productIn("c-borrada", "huerfana", "Huérfana")],
      categories: initial.categories
    };
    answerProducts = serve(snapshot);
    renderStorefront({ initialCatalog: initial });
    await refetchCatalog();

    await waitFor(() => expect(sectionTitles()).toEqual(["Clásicas", "Especiales", "Más opciones"]));
    expect(within(menu().getByRole("region", { name: "Clásicas" })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Clásica"]);
  });
});
