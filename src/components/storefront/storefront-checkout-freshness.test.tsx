import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fallbackProducts, categories as fixtureCategories } from "@/data/catalog";
import type { PublicStoreStatus } from "@/domain/store-status";
import type { Product } from "@/domain/types";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";
import { PRODUCTS_ENDPOINT } from "./use-public-catalog";
import { PROMOTIONS_ENDPOINT } from "./use-public-promotions";
import { STORE_STATUS_ENDPOINT } from "./use-store-status";
import { WHATSAPP_CHECKOUT_ENDPOINT } from "./use-whatsapp-checkout";

/*
 * BB-10 review round 1 (P1 A/B) through the whole storefront: once a quote is invalidated by a
 * re-read (catalog, store status, promotions) its link never shows again, not even for one
 * render, while the next quote is pending, failed or refused. A pause or closure reached between
 * two reads removes the link, and the cart stays editable throughout.
 */

const TIMEZONE = "America/Argentina/Tucuman";
const open: PublicStoreStatus = { state: "open", acceptingOrders: true, reason: "manual_open", closesAt: null, nextOpeningAt: null, deliveryFeeCents: "120000", timezone: TIMEZONE };
const paused: PublicStoreStatus = { ...open, state: "paused", acceptingOrders: false, reason: "manual_paused" };

const quote = (name: string, totalCents: string) => ({
  url: `https://wa.me/5493865207458?text=${name}`,
  subtotalCents: totalCents,
  discountCents: "0",
  deliveryCents: "0",
  totalCents,
  promotion: null
});
const A = quote("A", "780000");
const B = quote("B", "850000");

type Handler = () => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

let queues: Record<string, Handler[]>;
const checkoutBodies: unknown[] = [];

/** Each endpoint answers with its queued handlers in order; the last one repeats. */
function serve(initial: Record<string, Handler[]>) {
  queues = initial;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === WHATSAPP_CHECKOUT_ENDPOINT) checkoutBodies.push(JSON.parse(String(init.body)));
      const queue = queues[url];
      if (!queue || queue.length === 0) throw new Error(`unexpected request ${url}`);
      const handler = queue.length > 1 ? queue.shift()! : queue[0]!;
      return handler();
    })
  );
}

const catalog = (items: Product[] = fallbackProducts): Handler => () => json(serializePublicCatalog({ products: items, categories: fixtureCategories }));

/** Records whether a link to `href` is ever in the DOM after `arm()`, even for a single commit. */
function watchLink(href: string) {
  let armed = false;
  let seen = false;
  const check = () => {
    if (armed && document.querySelector(`a[href="${href}"]`)) seen = true;
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["href"] });
  return {
    arm() {
      armed = true;
      check();
    },
    get seen() {
      check();
      return seen;
    },
    stop: () => observer.disconnect()
  };
}

const checkout = () => within(screen.getByRole("region", { name: "Finalizar pedido" }));
const link = () => checkout().queryByRole("link", { name: "Enviar pedido por WhatsApp" });

async function orderWithLinkA(user: ReturnType<typeof userEvent.setup>) {
  render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
  await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
  expect(await checkout().findByRole("link", { name: "Enviar pedido por WhatsApp" })).toHaveAttribute("href", A.url);
}

beforeEach(() => {
  localStorage.clear();
  checkoutBodies.length = 0;
});

afterEach(() => vi.unstubAllGlobals());

describe("checkout link freshness in the storefront", () => {
  it("drops link A on re-verification and never shows it again while B is pending, failed or valid", async () => {
    const pendingB = deferred();
    serve({
      [STORE_STATUS_ENDPOINT]: [() => json(open)],
      [PRODUCTS_ENDPOINT]: [catalog()],
      [PROMOTIONS_ENDPOINT]: [() => json({ promotions: [] })],
      [WHATSAPP_CHECKOUT_ENDPOINT]: [() => json(A), () => pendingB.promise, () => json(B)]
    });
    const user = userEvent.setup();
    await orderWithLinkA(user);
    const watcher = watchLink(A.url);

    // Focus re-reads the catalog and the store status: the link goes away as the re-read starts.
    act(() => window.dispatchEvent(new Event("focus")));
    watcher.arm();
    expect(link()).toBeNull();

    // Same request again (same ids, quantity, options, notes) while B is pending: no link.
    await waitFor(() => expect(checkoutBodies).toHaveLength(2));
    expect(checkoutBodies[1]).toEqual(checkoutBodies[0]);
    expect(checkout().getByRole("button", { name: "Calculando el total…" })).toBeDisabled();
    expect(checkout().getByTestId("checkout-total")).toHaveTextContent("Total estimado");

    // B fails: still no link.
    await act(async () => pendingB.resolve(json({ error: "unavailable" }, 503)));
    expect(await checkout().findByRole("alert")).toHaveTextContent("No pudimos calcular el total");
    expect(link()).toBeNull();

    // The next re-verification yields a valid B: B's link, never A's.
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await checkout().findByRole("link", { name: "Enviar pedido por WhatsApp" })).toHaveAttribute("href", B.url);
    expect(checkout().getByTestId("checkout-total")).toHaveTextContent("$ 8.500");
    expect(watcher.seen).toBe(false);
    watcher.stop();
  });

  it("drops link A when the price changes with the same request, and shows B's total", async () => {
    const repriced = fallbackProducts.map((product) => (product.id === "smash-doble" ? { ...product, priceCents: 850000n } : product));
    serve({
      [STORE_STATUS_ENDPOINT]: [() => json(open)],
      [PRODUCTS_ENDPOINT]: [catalog(), catalog(repriced)],
      [PROMOTIONS_ENDPOINT]: [() => json({ promotions: [] })],
      [WHATSAPP_CHECKOUT_ENDPOINT]: [() => json(A), () => json(B)]
    });
    const user = userEvent.setup();
    await orderWithLinkA(user);
    const watcher = watchLink(A.url);

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    watcher.arm();
    expect(await checkout().findByRole("link", { name: "Enviar pedido por WhatsApp" })).toHaveAttribute("href", B.url);
    expect(checkoutBodies[1]).toEqual(checkoutBodies[0]);
    expect(watcher.seen).toBe(false);
    watcher.stop();
  });

  it("drops the shown link when only the published promotions change, with the same request", async () => {
    const promotionsB = {
      promotions: [
        {
          id: "promo-1",
          slug: "promo-1",
          name: "Jueves Búnker",
          priority: 1,
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2027-01-01T00:00:00.000Z",
          mechanic: { type: "percent_off", percentOff: 10 },
          channels: ["delivery", "pickup"],
          items: [],
          schedule: []
        }
      ]
    };
    const C = quote("C", "702000");
    const pendingPromotions = deferred();
    const pendingC = deferred();
    serve({
      [STORE_STATUS_ENDPOINT]: [() => json(open)],
      [PRODUCTS_ENDPOINT]: [catalog()],
      [PROMOTIONS_ENDPOINT]: [() => json({ promotions: [] }), () => pendingPromotions.promise],
      [WHATSAPP_CHECKOUT_ENDPOINT]: [() => json(A), () => json(B), () => pendingC.promise]
    });
    const user = userEvent.setup();
    await orderWithLinkA(user);

    // Catalog and status re-read and quote B arrives while the promotions read is still pending.
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(await checkout().findByRole("link", { name: "Enviar pedido por WhatsApp" })).toHaveAttribute("href", B.url);
    const watcher = watchLink(B.url);

    // Only the promotions change now: nothing else is re-read and the request is identical,
    // yet link B goes away until the server prices the cart again.
    await act(async () => pendingPromotions.resolve(json(promotionsB)));
    watcher.arm();
    expect(link()).toBeNull();
    await waitFor(() => expect(checkoutBodies).toHaveLength(3));
    expect(checkoutBodies[2]).toEqual(checkoutBodies[1]);
    expect(checkout().getByTestId("checkout-total")).toHaveTextContent("Total estimado");

    await act(async () => pendingC.resolve(json(C)));
    expect(await checkout().findByRole("link", { name: "Enviar pedido por WhatsApp" })).toHaveAttribute("href", C.url);
    expect(watcher.seen).toBe(false);
    expect(document.querySelector(`a[href="${A.url}"]`)).toBeNull();
    watcher.stop();
  });

  it.each([
    ["paused", () => json(paused), "El local pausó los pedidos por un momento.", "El local no está tomando pedidos"],
    ["unreachable", () => json({ acceptingOrders: false, error: "unavailable" }, 503), "No pudimos verificar si el local está tomando pedidos.", "El local no está tomando pedidos"]
  ])("removes the link when the store is %s at the next read, and keeps the cart editable", async (_case, second, message, label) => {
    const pendingStatus = deferred();
    serve({
      [STORE_STATUS_ENDPOINT]: [() => json(open), () => pendingStatus.promise],
      [PRODUCTS_ENDPOINT]: [catalog()],
      [PROMOTIONS_ENDPOINT]: [() => json({ promotions: [] })],
      [WHATSAPP_CHECKOUT_ENDPOINT]: [() => json(A)]
    });
    const user = userEvent.setup();
    await orderWithLinkA(user);
    const watcher = watchLink(A.url);

    act(() => window.dispatchEvent(new Event("focus")));
    watcher.arm();
    // Mid re-read: the last answer is shown, but nothing can be sent.
    expect(link()).toBeNull();
    expect(checkout().getByRole("button", { name: "Verificando el local…" })).toBeDisabled();

    await act(async () => pendingStatus.resolve(second()));
    await waitFor(() => expect(screen.getByTestId("store-status")).toHaveTextContent(message));
    expect(checkout().getByRole("button", { name: label })).toBeDisabled();
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();

    // The cart and the menu keep working while the checkout is blocked.
    await user.click(screen.getByRole("button", { name: "Agregar uno de Smash Búnker Doble" }));
    expect(screen.getByLabelText("Carrito, 2 productos")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));
    expect(screen.getByLabelText("Carrito, 3 productos")).toBeInTheDocument();
    expect(watcher.seen).toBe(false);
    watcher.stop();
  });
});
