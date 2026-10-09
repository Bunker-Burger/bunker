import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fallbackProducts, categories as fixtureCategories } from "@/data/catalog";
import type { PublicStoreStatus } from "@/domain/store-status";
import { serializePublicCatalog } from "@/server/catalog/public-products";
import { resetCartStoreForTesting } from "@/lib/cart-store";
import { Storefront } from "./storefront";
import { PRODUCTS_ENDPOINT } from "./use-public-catalog";
import { PROMOTIONS_ENDPOINT } from "./use-public-promotions";
import { STORE_STATUS_ENDPOINT } from "./use-store-status";
import { WHATSAPP_CHECKOUT_ENDPOINT } from "./use-whatsapp-checkout";

const TIMEZONE = "America/Argentina/Tucuman";
const openStatus: PublicStoreStatus = {
  state: "open",
  acceptingOrders: true,
  reason: "schedule",
  closesAt: "2026-10-08T03:00:00.000Z",
  nextOpeningAt: null,
  deliveryFeeCents: "150000",
  timezone: TIMEZONE
};

const pausedStatus: PublicStoreStatus = {
  state: "paused",
  acceptingOrders: false,
  reason: "manual_paused",
  closesAt: null,
  nextOpeningAt: null,
  deliveryFeeCents: "150000",
  timezone: TIMEZONE
};

const requests: Array<{ url: string; method: string; body: unknown }> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setupFetch(options?: {
  storeStatus?: PublicStoreStatus;
  mpCreateResponse?: { status: number; body: unknown };
}) {
  const currentStatus = options?.storeStatus ?? openStatus;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined
      });

      if (url.includes(STORE_STATUS_ENDPOINT)) {
        return json(currentStatus);
      }
      if (url.includes(PRODUCTS_ENDPOINT)) {
        return json(serializePublicCatalog({ products: fallbackProducts, categories: fixtureCategories }));
      }
      if (url.includes(PROMOTIONS_ENDPOINT)) {
        return json([]);
      }
      if (url.includes(WHATSAPP_CHECKOUT_ENDPOINT)) {
        return json({
          url: "https://wa.me/test",
          subtotalCents: "800000",
          discountCents: "0",
          deliveryCents: "0",
          totalCents: "800000",
          promotion: null
        });
      }
      if (url.includes("/api/checkout/mercado-pago")) {
        if (options?.mpCreateResponse) {
          return json(options.mpCreateResponse.body, options.mpCreateResponse.status);
        }
        return json({
          preferenceId: "pref_test_123",
          checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref_test_123",
          externalReference: "ext_ref_123"
        });
      }
      return json({ error: "not_found" }, 404);
    })
  );
}

describe("Mercado Pago Storefront Integration (BB-14)", () => {
  beforeEach(() => {
    requests.length = 0;
    localStorage.clear();
    resetCartStoreForTesting();
  });

  afterEach(() => {
    resetCartStoreForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hides Mercado Pago when mercadoPagoEnabled is false", async () => {
    setupFetch();
    render(
      <Storefront
        initialProductSlug={null}
        mercadoPagoEnabled={false}
        paymentMethods={["cash", "bank_transfer", "mercado_pago"]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Finalizar pedido")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/Mercado Pago/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Transferencia/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Efectivo/i)).toBeInTheDocument();
  });

  it("displays Mercado Pago choice and customer inputs when selected", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(
      <Storefront
        initialProductSlug={null}
        mercadoPagoEnabled={true}
        paymentMethods={["cash", "bank_transfer", "mercado_pago"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Agregar Smash Búnker Doble/i }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Mercado Pago/i })).toBeInTheDocument();
    });

    const mpRadio = screen.getByRole("radio", { name: /Mercado Pago/i });
    await user.click(mpRadio);

    // Customer name and phone inputs must now be visible
    expect(screen.getByLabelText(/Nombre y apellido/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Teléfono \/ WhatsApp/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Solo te pedimos nombre y teléfono para identificar tu pago/i)
    ).toBeInTheDocument();

    // With inputs empty, button is disabled
    const submitBtn = screen.getByTestId("mp-submit-button");
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent("Ingresá nombre y teléfono");
  });

  it("validates customer inputs and enables submit button", async () => {
    const user = userEvent.setup();
    setupFetch();

    render(
      <Storefront
        initialProductSlug={null}
        mercadoPagoEnabled={true}
        paymentMethods={["cash", "bank_transfer", "mercado_pago"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Agregar Smash Búnker Doble/i }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Mercado Pago/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("radio", { name: /Mercado Pago/i }));

    const nameInput = screen.getByLabelText(/Nombre y apellido/i);
    const phoneInput = screen.getByLabelText(/Teléfono \/ WhatsApp/i);
    const submitBtn = screen.getByTestId("mp-submit-button");

    await user.type(nameInput, "Juan Pérez");
    expect(submitBtn).toBeDisabled(); // Phone still empty

    await user.type(phoneInput, "1123456789");
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent("Pagar con Mercado Pago");
  });

  it("submits checkout payload without authoritative prices and handles redirection", async () => {
    const user = userEvent.setup();
    setupFetch();

    const redirectMock = vi.fn();

    render(
      <Storefront
        initialProductSlug={null}
        mercadoPagoEnabled={true}
        paymentMethods={["cash", "bank_transfer", "mercado_pago"]}
        onCheckoutRedirect={redirectMock}
      />
    );

    await user.click(screen.getByRole("button", { name: /Agregar Smash Búnker Doble/i }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Mercado Pago/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("radio", { name: /Mercado Pago/i }));
    await user.type(screen.getByLabelText(/Nombre y apellido/i), "Martín Fierro");
    await user.type(screen.getByLabelText(/Teléfono \/ WhatsApp/i), "3815551234");

    const submitBtn = screen.getByTestId("mp-submit-button");
    await user.click(submitBtn);

    await waitFor(() => {
      const mpReq = requests.find((r) => r.url === "/api/checkout/mercado-pago");
      expect(mpReq).toBeDefined();
      expect(mpReq?.method).toBe("POST");
      const body = mpReq?.body as Record<string, unknown>;
      expect(body.customer).toEqual({ name: "Martín Fierro", phone: "3815551234" });
      expect(body.fulfilment).toBe("pickup");
      // Check that client didn't send unitPriceCents or totalCents
      const items = body.items as Array<Record<string, unknown>>;
      expect(items[0]).not.toHaveProperty("unitPriceCents");
      expect(body).not.toHaveProperty("totalCents");
      expect(redirectMock).toHaveBeenCalledWith(
        "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref_test_123"
      );
    });
  });

  it("disables submit button when store is closed or paused", async () => {
    const user = userEvent.setup();
    setupFetch({ storeStatus: pausedStatus });

    render(
      <Storefront
        initialProductSlug={null}
        mercadoPagoEnabled={true}
        paymentMethods={["cash", "bank_transfer", "mercado_pago"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Agregar Smash Búnker Doble/i }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Mercado Pago/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("radio", { name: /Mercado Pago/i }));
    await user.type(screen.getByLabelText(/Nombre y apellido/i), "Martín Fierro");
    await user.type(screen.getByLabelText(/Teléfono \/ WhatsApp/i), "3815551234");

    const submitBtn = screen.getByTestId("mp-submit-button");
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent("No se pueden enviar pedidos ahora");
  });
});
