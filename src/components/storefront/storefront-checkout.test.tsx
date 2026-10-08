import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStoreStatus } from "@/domain/store-status";
import { Storefront } from "./storefront";
import { STORE_STATUS_ENDPOINT } from "./use-store-status";

/*
 * The checkout must never offer a way to send an order from the browser: with the store paused
 * or closed (and, until BB-10 provides a server-validated quote, even when open). Browsing and the
 * persisted cart keep working whatever the status endpoint says, including when it never answers.
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

const statusRequests: string[] = [];

function serveStatus(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      statusRequests.push(String(input));
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    })
  );
}

function neverAnswer() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      statusRequests.push(String(input));
      return new Promise<Response>(() => undefined);
    })
  );
}

/** Adds a burger, chooses delivery and completes every customer field. */
async function fillCompleteOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
  const checkout = screen.getByRole("region", { name: "Finalizar pedido" });
  await user.click(within(checkout).getByRole("radio", { name: /Delivery/ }));
  await user.type(within(checkout).getByLabelText("Tu nombre"), "Ana Pérez");
  await user.type(within(checkout).getByLabelText("Dirección"), "San Martín 123, Aguilares");
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
  statusRequests.length = 0;
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
    expect(statusRequests).toEqual([STORE_STATUS_ENDPOINT]);

    // The cart stays persisted and the menu stays usable.
    expect(localStorage.getItem("bunker-cart")).toContain("smash-doble");
    await user.click(screen.getByRole("button", { name: "Papas" }));
    expect(screen.getByRole("heading", { name: "Papas Búnker" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar Papas Búnker" }));
    expect(screen.getByLabelText("Carrito, 2 productos")).toBeInTheDocument();
  });

  it("does not turn a browser-computed total into a confirmation even when the store is open", async () => {
    serveStatus(statuses.open);
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkout = await fillCompleteOrder(user);

    await waitFor(() => expect(screen.getByTestId("store-status")).toHaveTextContent("El local está abierto hasta las 00:00."));
    expect(within(checkout).getByRole("button", { name: "Confirmación por WhatsApp próximamente" })).toBeDisabled();
    expectNoSendAction(checkout);
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
    expectNoSendAction(screen.getByRole("region", { name: "Finalizar pedido" }));
  });
});
