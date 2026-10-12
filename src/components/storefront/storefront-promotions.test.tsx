import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as promotionsRoute } from "@/app/api/store/promotions/route";
import { GET as storeStatusRoute } from "@/app/api/store/status/route";
import { formatArs } from "@/lib/money";
import { getPromotionsForQuote, getStoreStatus } from "@/server/catalog";
import { createAuthoritativeQuote } from "@/server/checkout/quote";
import type { PaymentQuote } from "@/server/payments/ports";
import { Storefront } from "./storefront";
import { PROMOTIONS_REFRESH_MS } from "./use-public-promotions";

/*
 * BB-09 end to end inside the test process: the storefront fetches the real route handlers
 * (`/api/store/promotions`, `/api/store/status`), which go through the production services,
 * Supabase client and repository. Only the network to Supabase is replaced, by a fake
 * PostgREST over a mutable "database" (with the public RLS rule: paused rules are not
 * returned). The authoritative quote reads the same database through `getPromotionsForQuote`.
 * No promotion is ever passed to the component.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined })
}));

// Tuesday 2026-10-13 21:00 and Wednesday 2026-10-14 21:00 in Tucumán (UTC-3).
const TUESDAY_NIGHT = new Date("2026-10-14T00:00:00Z");
const WEDNESDAY_NIGHT = new Date("2026-10-15T00:00:00Z");

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";
const SMASH_ID = "0199b2c8-40b0-7000-8000-000000000201";

interface PromotionState {
  active: boolean;
  percentOff: number;
  delivery: boolean;
  pickup: boolean;
  description: string;
  badgeText: string | null;
}

let promotion: PromotionState;
let promotionsFail: boolean;

const storeRow = () => ({
  id: STORE_ID,
  name: "Búnker Burger",
  slug: "bunker-burger",
  whatsapp_e164: "+5493865207458",
  timezone: "America/Argentina/Tucuman",
  currency: "ARS",
  status_override: "open",
  is_public: true,
  delivery_fee_cents: "120000",
  store_business_hours: [],
  store_payment_methods: []
});

const promotionRow = () => ({
  id: "0199b2c8-40b0-7000-8000-000000000501",
  slug: "martes-de-smash",
  name: "Martes de Smash",
  description: promotion.description,
  badge_text: promotion.badgeText,
  promotion_type: "percent_off",
  priority: 10,
  is_active: promotion.active,
  starts_at: "2026-10-01T03:00:00+00:00",
  ends_at: "2027-04-01T02:59:00+00:00",
  fixed_price_cents: null,
  percent_off: promotion.percentOff,
  buy_quantity: null,
  get_quantity: null,
  applies_to_delivery: promotion.delivery,
  applies_to_pickup: promotion.pickup,
  promotion_items: [{ product_id: SMASH_ID, quantity: 1 }],
  promotion_schedule: [{ day_of_week: 2, starts_at: "18:00:00", ends_at: "23:59:00" }]
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function supabase(url: URL, headers: Headers): Response {
  const table = url.pathname.replace("/rest/v1/", "");
  switch (table) {
    case "stores":
      return json(headers.get("accept")?.includes("vnd.pgrst.object") ? storeRow() : [storeRow()]);
    case "promotion_rules":
      if (promotionsFail) return json({ message: "boom", code: "XX000" }, 500);
      // RLS `promotion_rules_public_read`: anonymous reads only see active rules.
      return json(promotion.active ? [promotionRow()] : []);
    case "products":
      return json([{ id: SMASH_ID, slug: "smash-bunker-doble" }]);
    default:
      return json({ message: `unexpected table ${table}` }, 404);
  }
}

const publishedBodies: unknown[] = [];

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_PROJECT_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_PRODUCTION_PROJECT_REF", "");
  promotion = { active: true, percentOff: 15, delivery: true, pickup: true, description: "", badgeText: "15% OFF" };
  promotionsFail = false;
  publishedBodies.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
      if (url.origin === SUPABASE_URL) return supabase(url, new Headers(init.headers));
      if (url.pathname === "/api/store/promotions") {
        const response = await promotionsRoute();
        publishedBodies.push(await response.clone().json());
        return response;
      }
      if (url.pathname === "/api/store/status") return storeStatusRoute();
      throw new Error(`unexpected request ${url.href}`);
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function at(instant: Date) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(instant);
}

/** The next periodic re-read of the promotions endpoint. */
async function nextRefresh() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PROMOTIONS_REFRESH_MS);
  });
}

const smashCard = () => within(screen.getByRole("heading", { name: "Smash Búnker Doble" }).closest("article") as HTMLElement);
const summary = () => within(screen.getByRole("heading", { name: "Resumen de la orden" }).parentElement as HTMLElement);
const estimatedTotal = () => summary().getByText("Total estimado").nextElementSibling;
// As rendered text: formatArs separates the sign with a no-break space.
const displayed = (cents: bigint) => formatArs(cents).replace(/\s/g, " ");
const subtotal = () => summary().getByText("Subtotal productos").nextElementSibling;

/** What the server would charge for one Smash Búnker Doble, from the same database. */
async function authoritativeQuote(fulfilment: "pickup" | "delivery"): Promise<PaymentQuote> {
  return createAuthoritativeQuote(
    { items: [{ productId: SMASH_ID, quantity: 1, optionSelections: {}, notes: "" }], fulfilment, paymentMethod: "cash_exact" },
    {
      repository: {
        async findProduct(id) {
          return id === SMASH_ID
            ? { id, name: "Smash Búnker Doble", type: "burger", priceCents: 780000n, available: true, optionGroups: [] }
            : null;
        },
        async listPromotions() {
          const rules = await getPromotionsForQuote();
          if (!rules.ok) throw new Error(rules.error.message);
          return rules.value;
        }
      },
      quotes: { async save() {}, async findById() { return null; } },
      async storeStatus() {
        const status = await getStoreStatus();
        if (!status.ok) throw new Error(status.error.message);
        return status.value;
      },
      createId: () => "quote",
      now: () => new Date()
    }
  );
}

async function renderWithSmashInCart() {
  const user = userEvent.setup({ advanceTimers: () => undefined });
  render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
  await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
  // Both public endpoints answered.
  await screen.findByText(/El local está abierto/);
  return user;
}

describe("promotions in the storefront, read from the public route", () => {
  it("announces the rule the database publishes, and the authoritative quote agrees", async () => {
    at(TUESDAY_NIGHT);
    await renderWithSmashInCart();

    expect(await smashCard().findByText("$ 6.630")).toBeInTheDocument();
    expect(smashCard().getByText("$ 7.800", { selector: "s" })).toBeInTheDocument();
    expect(smashCard().getByText("Martes de Smash: 15% de descuento en productos seleccionados")).toBeInTheDocument();
    const applied = within(screen.getByTestId("applied-promotion"));
    expect(applied.getByText("Promoción: Martes de Smash")).toBeInTheDocument();
    expect(applied.getByText("-$ 1.170")).toBeInTheDocument();
    expect(applied.getByText("15% de descuento en productos seleccionados. No se acumula con otras promociones.")).toBeInTheDocument();
    expect(subtotal()).toHaveTextContent("$ 7.800");
    expect(estimatedTotal()).toHaveTextContent("$ 6.630");

    const quote = await authoritativeQuote("pickup");
    expect(quote).toMatchObject({ subtotalCents: 780000n, discountCents: 117000n, totalCents: 663000n });
    expect(quote.promotion?.explanation).toBe("15% de descuento en productos seleccionados");
    expect(estimatedTotal()).toHaveTextContent(displayed(quote.totalCents));
  });

  it("shows the card's promotional price in the product detail too, and where the discount lands", async () => {
    at(TUESDAY_NIGHT);
    const user = await renderWithSmashInCart();
    await smashCard().findByText("$ 6.630");
    await user.click(smashCard().getByRole("button", { name: "Ver Smash Búnker Doble" }));
    const detail = await screen.findByRole("dialog");
    expect(within(detail).getByText("$ 6.630")).toBeInTheDocument();
    expect(within(detail).getByText("$ 7.800", { selector: "s" })).toBeInTheDocument();
    expect(within(detail).getByText(/El descuento se aplica al confirmar el pedido/)).toBeInTheDocument();
  });

  it("stops announcing a promotion paused in the database at the next read", async () => {
    at(TUESDAY_NIGHT);
    await renderWithSmashInCart();
    expect(await smashCard().findByText("$ 6.630")).toBeInTheDocument();

    promotion.active = false;
    await nextRefresh();

    expect(smashCard().queryByText("$ 7.800", { selector: "s" })).not.toBeInTheDocument();
    expect(smashCard().queryByText(/de descuento/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("applied-promotion")).not.toBeInTheDocument();
    expect(estimatedTotal()).toHaveTextContent("$ 7.800");

    const quote = await authoritativeQuote("pickup");
    expect(quote).toMatchObject({ discountCents: 0n, totalCents: 780000n, promotion: null });
    expect(estimatedTotal()).toHaveTextContent(displayed(quote.totalCents));
  });

  it("shows a percentage edited in the database at the next read", async () => {
    at(TUESDAY_NIGHT);
    await renderWithSmashInCart();
    expect(await smashCard().findByText("$ 6.630")).toBeInTheDocument();

    promotion.percentOff = 25;
    await nextRefresh();

    expect(smashCard().getByText("$ 5.850")).toBeInTheDocument();
    expect(smashCard().getByText("Martes de Smash: 25% de descuento en productos seleccionados")).toBeInTheDocument();
    expect(within(screen.getByTestId("applied-promotion")).getByText("-$ 1.950")).toBeInTheDocument();
    expect(subtotal()).toHaveTextContent("$ 7.800");
    expect(estimatedTotal()).toHaveTextContent("$ 5.850");

    const quote = await authoritativeQuote("pickup");
    expect(quote).toMatchObject({ discountCents: 195000n, totalCents: 585000n });
    expect(estimatedTotal()).toHaveTextContent(displayed(quote.totalCents));
  });

  it("only shows a delivery-only promotion once delivery is chosen, like the quote", async () => {
    at(TUESDAY_NIGHT);
    promotion.pickup = false;
    const user = await renderWithSmashInCart();
    await nextRefresh();

    // Pickup (default): no struck price, no discount; the server agrees.
    expect(smashCard().queryByText("$ 7.800", { selector: "s" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("applied-promotion")).not.toBeInTheDocument();
    expect(estimatedTotal()).toHaveTextContent("$ 7.800");
    expect(await authoritativeQuote("pickup")).toMatchObject({ discountCents: 0n, totalCents: 780000n });

    await user.click(screen.getByRole("radio", { name: /Delivery/ }));

    expect(smashCard().getByText("$ 7.800", { selector: "s" })).toBeInTheDocument();
    expect(smashCard().getByText("$ 6.630")).toBeInTheDocument();
    expect(within(screen.getByTestId("applied-promotion")).getByText("-$ 1.170")).toBeInTheDocument();
    // 7.800 − 1.170 + 1.200 delivery.
    expect(estimatedTotal()).toHaveTextContent("$ 7.830");
    const quote = await authoritativeQuote("delivery");
    expect(quote).toMatchObject({ discountCents: 117000n, deliveryCents: 120000n, totalCents: 783000n });
    expect(estimatedTotal()).toHaveTextContent(displayed(quote.totalCents));

    await user.click(screen.getByRole("radio", { name: /Retiro en local/ }));
    expect(smashCard().queryByText("$ 7.800", { selector: "s" })).not.toBeInTheDocument();
    expect(estimatedTotal()).toHaveTextContent("$ 7.800");
  });

  it("shows no promotion outside its weekly window, like the quote", async () => {
    at(WEDNESDAY_NIGHT);
    await renderWithSmashInCart();
    await nextRefresh();

    expect(publishedBodies.at(-1)).toMatchObject({ promotions: [{ slug: "martes-de-smash" }] });
    expect(smashCard().queryByText("$ 7.800", { selector: "s" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("applied-promotion")).not.toBeInTheDocument();
    expect(await authoritativeQuote("pickup")).toMatchObject({ discountCents: 0n, promotion: null });
  });

  it("never publishes nor displays admin free text as the promotion's price or explanation", async () => {
    at(TUESDAY_NIGHT);
    promotion.description = "¡Todo a $1!";
    promotion.badgeText = "$1";
    await renderWithSmashInCart();

    expect(await smashCard().findByText("$ 6.630")).toBeInTheDocument();
    expect(screen.queryByText(/\$1\b|Todo a/)).not.toBeInTheDocument();
    expect(JSON.stringify(publishedBodies)).not.toMatch(/Todo a|badge|description/);
  });

  it("announces no discount when the promotions cannot be read", async () => {
    at(TUESDAY_NIGHT);
    promotionsFail = true;
    await renderWithSmashInCart();
    await nextRefresh();

    expect(publishedBodies.at(-1)).toEqual({ error: "unavailable" });
    expect(smashCard().queryByText("$ 7.800", { selector: "s" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("applied-promotion")).not.toBeInTheDocument();
    expect(estimatedTotal()).toHaveTextContent("$ 7.800");
  });
});
