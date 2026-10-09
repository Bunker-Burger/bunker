import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fallbackProducts } from "@/data/catalog";
import type { PublicStoreStatus } from "@/domain/store-status";
import { serializePublicProducts } from "@/server/catalog/public-products";
import { Storefront } from "./storefront";
import { PRODUCTS_ENDPOINT } from "./use-public-catalog";
import { PROMOTIONS_ENDPOINT } from "./use-public-promotions";
import { STORE_STATUS_ENDPOINT } from "./use-store-status";
import { WHATSAPP_CHECKOUT_ENDPOINT } from "./use-whatsapp-checkout";

/*
 * BB-08 + BB-10: the checkout only offers a way to send an order as a WhatsApp link the server
 * built after recomputing the total. With the store paused or closed, an unverified catalog or
 * a refused cart there is no link. Browsing and the persisted cart keep working whatever the
 * status endpoint says, including when it never answers. No personal data is asked for.
 */

const TIMEZONE = "America/Argentina/Tucuman";
const statuses: Record<string, PublicStoreStatus> = {
  paused: { state: "paused", acceptingOrders: false, reason: "manual_paused", closesAt: null, nextOpeningAt: null, deliveryFeeCents: "120000", timezone: TIMEZONE },
  closed: { state: "closed", acceptingOrders: false, reason: "manual_closed", closesAt: null, nextOpeningAt: null, deliveryFeeCents: "120000", timezone: TIMEZONE },
  closedBySchedule: {
    state: "closed",
    acceptingOrders: false,
    reason: "schedule",
    closesAt: null,
    nextOpeningAt: "2026-10-07T22:30:00.000Z",
    deliveryFeeCents: "120000",
    timezone: TIMEZONE
  },
  open: {
    state: "open",
    acceptingOrders: true,
    reason: "schedule",
    closesAt: "2026-10-08T03:00:00.000Z",
    nextOpeningAt: null,
    deliveryFeeCents: "150000",
    timezone: TIMEZONE
  }
};

const SERVER_URL = "https://wa.me/5493865207458?text=Hola%20B%C3%BAnker%20Burger!";
const serverCheckout = {
  url: SERVER_URL,
  subtotalCents: "780000",
  discountCents: "0",
  deliveryCents: "150000",
  // Deliberately different from the browser estimate: the server's total is the one shown.
  totalCents: "999900",
  promotion: null
};

const requests: Array<{ url: string; method: string; body: unknown }> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Every endpoint answers with the status body (so the catalog cannot be verified). */
function serveStatus(body: unknown, status = 200) {
  serve({ status: () => json(body, status), products: () => json(body, status) });
}

function serve(routes: { status: () => Response; products?: () => Response; checkout?: () => Response }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url === STORE_STATUS_ENDPOINT) return routes.status();
      if (url === PRODUCTS_ENDPOINT) return (routes.products ?? routes.status)();
      if (url === WHATSAPP_CHECKOUT_ENDPOINT && routes.checkout) return routes.checkout();
      return json({ error: "unavailable" }, 503);
    })
  );
}

/** Open store, verified catalog and a server checkout that answers with `checkout`. */
function serveOpenStore(checkout: () => Response = () => json(serverCheckout)) {
  serve({
    status: () => json(statuses.open),
    products: () => json({ products: serializePublicProducts(fallbackProducts) }),
    checkout
  });
}

function neverAnswer() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      requests.push({ url: String(input), method: "GET", body: undefined });
      return new Promise<Response>(() => undefined);
    })
  );
}

const checkoutRequests = () => requests.filter((request) => request.url === WHATSAPP_CHECKOUT_ENDPOINT);
const checkoutRegion = () => screen.getByRole("region", { name: "Finalizar pedido" });

/** Adds a burger and chooses delivery: everything the app asks before WhatsApp. */
async function fillCompleteOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
  const checkout = checkoutRegion();
  await user.click(within(checkout).getByRole("radio", { name: /Delivery/ }));
  return checkout;
}

/** Nothing in the page can open WhatsApp or submit the order. */
function expectNoSendAction(checkout: HTMLElement) {
  expect(document.querySelector('a[href*="wa.me"], a[href*="whatsapp"], form[action]')).toBeNull();
  expect(within(checkout).queryAllByRole("link")).toEqual([]);
  for (const button of within(checkout).queryAllByRole("button")) {
    if (/confirm|enviar|whatsapp|pedido/i.test(button.textContent ?? "")) expect(button).toBeDisabled();
  }
}

beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
});

afterEach(() => vi.unstubAllGlobals());

describe("checkout with the real store status", () => {
  it.each([
    ["paused", statuses.paused, "El local pausó los pedidos por un momento."],
    ["closed", statuses.closed, "El local está cerrado."],
    ["closed by schedule", statuses.closedBySchedule, "El local está cerrado. Abre el miércoles a las 19:30."]
  ])("offers no way to send a complete order while the store is %s", async (_case, status, message) => {
    serveStatus(status);
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkout = await fillCompleteOrder(user);

    await waitFor(() => expect(screen.getByTestId("store-status")).toHaveTextContent(message));
    expect(within(checkout).getByRole("button", { name: "No se pueden enviar pedidos ahora" })).toBeDisabled();
    expectNoSendAction(checkout);
    // The status, catalog verification (BB-06), plus promotions for the estimate (BB-09); no checkout.
    expect(requests.map((request) => request.url)).toEqual([STORE_STATUS_ENDPOINT, PRODUCTS_ENDPOINT, PROMOTIONS_ENDPOINT]);

    // The cart stays persisted and the menu stays usable.
    expect(localStorage.getItem("bunker-cart")).toContain("smash-doble");
    await user.click(screen.getByRole("button", { name: "Papas" }));
    expect(screen.getByRole("heading", { name: "Papas Búnker" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));
    expect(screen.getByLabelText("Carrito, 2 productos")).toBeInTheDocument();
  });

  it("does not turn a browser-computed total into a confirmation while the catalog is unverified", async () => {
    serveStatus(statuses.open);
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkout = await fillCompleteOrder(user);

    await waitFor(() => expect(screen.getByTestId("store-status")).toHaveTextContent("El local está abierto hasta las 00:00."));
    await screen.findByText(/Pendiente de verificar/);
    expect(within(checkout).getByRole("button", { name: "Enviar pedido por WhatsApp" })).toBeDisabled();
    expectNoSendAction(checkout);
    expect(checkoutRequests()).toEqual([]);
    // The delivery fee shown comes from the server's status, not a constant in the bundle.
    expect(within(checkout).getByRole("radio", { name: /Delivery/ }).closest("label")).toHaveTextContent("$ 1.500");
  });

  it("treats an unavailable status as 'could not verify', never as open", async () => {
    serveStatus({ acceptingOrders: false, error: "unavailable" }, 503);
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkout = await fillCompleteOrder(user);

    await waitFor(() => expect(screen.getByTestId("store-status")).toHaveTextContent("No pudimos verificar si el local está tomando pedidos."));
    expect(within(checkout).getByRole("button", { name: "No se pueden enviar pedidos ahora" })).toBeDisabled();
    expect(within(checkout).getByRole("radio", { name: /Delivery/ }).closest("label")).toHaveTextContent("A confirmar");
    expectNoSendAction(checkout);
  });

  it("never makes browsing or the cart wait for the status", async () => {
    neverAnswer();
    const user = userEvent.setup();
    render(<Storefront initialProductSlug="smash-bunker-doble" mercadoPagoEnabled={false} />);

    const dialog = screen.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await user.click(within(dialog).getByRole("button", { name: /Agregar 1 al carrito/ }));
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
    expect(screen.getByTestId("store-status")).toHaveTextContent("Verificando si el local está tomando pedidos…");
    expectNoSendAction(checkoutRegion());
  });
});

describe("WhatsApp checkout (BB-10)", () => {
  it("asks for no name, phone or address before WhatsApp", async () => {
    serveOpenStore();
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkout = await fillCompleteOrder(user);

    expect(within(checkout).queryAllByRole("textbox")).toEqual([]);
    expect(within(checkout).queryByLabelText(/nombre|teléfono|dirección/i)).toBeNull();
    expect(within(checkout).getByText(/la dirección y el pago se coordinan en el chat de WhatsApp/)).toBeInTheDocument();
  });

  it("sends only ids, quantities, options and notes, and links to the message the server built", async () => {
    serveOpenStore();
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkout = await fillCompleteOrder(user);

    const link = await within(checkout).findByRole("link", { name: "Enviar pedido por WhatsApp" });
    expect(link).toHaveAttribute("href", SERVER_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The total shown is the server's, not the browser estimate.
    expect(within(screen.getByTestId("checkout-total")).getByText("Total")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("$ 9.999");

    const sent = checkoutRequests().at(-1);
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toEqual({
      items: [{ productId: "smash-doble", quantity: 1, optionSelections: { patty: ["double"] }, notes: "" }],
      fulfilment: "delivery",
      paymentMethod: "transfer"
    });
    expect(JSON.stringify(sent?.body)).not.toMatch(/price|total|cents|promotion|customer/i);
  });

  it("recomputes with the server when the payment method changes", async () => {
    serveOpenStore();
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const checkout = await fillCompleteOrder(user);
    await within(checkout).findByRole("link", { name: "Enviar pedido por WhatsApp" });

    expect(within(checkout).getByText("Pedí el alias por WhatsApp y enviá el comprobante por ese chat")).toBeInTheDocument();
    expect(within(checkout).queryByText(/CBU|CVU/)).toBeNull();
    await user.click(within(checkout).getByRole("radio", { name: /Efectivo exacto/ }));

    await waitFor(() => expect(checkoutRequests().at(-1)?.body).toMatchObject({ paymentMethod: "cash_exact" }));
    expect(await within(checkout).findByRole("link", { name: "Enviar pedido por WhatsApp" })).toHaveAttribute("href", SERVER_URL);
  });

  it("offers only the payment methods the store enabled", async () => {
    serveOpenStore();
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} paymentMethods={["cash"]} />);
    const checkout = await fillCompleteOrder(user);

    expect(within(checkout).queryByRole("radio", { name: /Transferencia/ })).toBeNull();
    await within(checkout).findByRole("link", { name: "Enviar pedido por WhatsApp" });
    expect(checkoutRequests().at(-1)?.body).toMatchObject({ paymentMethod: "cash_exact" });
  });

  it("gives no link when the server finds the store closed", async () => {
    serveOpenStore(() => json({ error: "store_closed" }, 409));
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const checkout = await fillCompleteOrder(user);

    expect(await within(checkout).findByRole("alert")).toHaveTextContent("El local no está tomando pedidos ahora.");
    expect(within(checkout).getByTestId("checkout-total")).toHaveTextContent("Total estimado");
    expectNoSendAction(checkout);
  });

  it("gives no link for a cart the server refuses, and re-checks the catalog once", async () => {
    serveOpenStore(() => json({ error: "invalid_cart" }, 422));
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const checkout = await fillCompleteOrder(user);

    expect(await within(checkout).findByRole("alert")).toHaveTextContent("Algo de tu carrito cambió");
    expectNoSendAction(checkout);
    await waitFor(() => expect(requests.filter((request) => request.url === PRODUCTS_ENDPOINT)).toHaveLength(2));
    // The re-checked catalog still offers the line: no further re-check loop for the same cart.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(within(checkout).getByRole("alert")).toHaveTextContent("Algo de tu carrito cambió");
    expect(requests.filter((request) => request.url === PRODUCTS_ENDPOINT)).toHaveLength(2);
  });

  it("never shows a link from a total that failed to load", async () => {
    serveOpenStore(() => json({ url: "https://evil.example/", subtotalCents: "1", discountCents: "0", deliveryCents: "0", totalCents: "1", promotion: null }));
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const checkout = await fillCompleteOrder(user);

    expect(await within(checkout).findByRole("alert")).toHaveTextContent("No pudimos calcular el total con el local.");
    expectNoSendAction(checkout);
  });
});
