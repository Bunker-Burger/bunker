import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { quoteCart } from "@/domain/pricing";
import type { PromotionRule } from "@/domain/types";
import { PromotionForm, previewRows, type PromotionFormProduct, type PromotionFormValues } from "./promotion-form";

vi.mock("./actions", () => ({ savePromotionAction: vi.fn() }));

const SMASH = "0199b2c8-40b0-7000-8000-000000000201";
const PAPAS = "0199b2c8-40b0-7000-8000-000000000206";
const DRAFT = "0199b2c8-40b0-7000-8000-000000000209";
const products: PromotionFormProduct[] = [
  { id: SMASH, name: "Smash", priceCents: "780000", published: true },
  { id: PAPAS, name: "Papas", priceCents: "350000", published: true },
  { id: DRAFT, name: "Burger del mes", priceCents: "0", published: false }
];

const defaults = (overrides: Partial<PromotionFormValues> = {}): PromotionFormValues => ({
  id: "",
  name: "",
  slug: "",
  description: "",
  badgeText: "",
  type: "percent_off",
  percentOff: "15",
  fixedPrice: "",
  buyQuantity: "2",
  getQuantity: "1",
  channels: ["delivery", "pickup"],
  startsAt: "2026-10-01T00:00",
  endsAt: "2026-12-31T23:59",
  active: false,
  items: [],
  schedule: [],
  ...overrides
});

const previewTable = () => within(screen.getByRole("region", { name: "Vista previa de precios" }));
// Intl formats "$ 7.800" with a no-break space.
const rowsText = () => previewTable().getAllByRole("row").slice(1).map((row) => row.textContent?.replace(/ /g, " "));

describe("previewRows", () => {
  it.each([
    ["percent off", { type: "percent_off", percentOff: 15 } as const, [{ productId: SMASH, quantity: 1 }], "pickup" as const],
    ["a combo", { type: "fixed_price", fixedPriceCents: 900000n } as const, [{ productId: SMASH, quantity: 1 }, { productId: PAPAS, quantity: 1 }], "pickup" as const],
    ["take 3 pay 2", { type: "buy_x_get_y", buyQuantity: 2, getQuantity: 1 } as const, [{ productId: PAPAS, quantity: 1 }], "pickup" as const],
    ["free delivery", { type: "free_delivery" } as const, [], "delivery" as const]
  ])("gives the same total as the authoritative quote for %s", (_case, mechanic, items, fulfilment) => {
    const fee = 120000n;
    const [row] = previewRows(mechanic, [fulfilment], items, products, fee);
    const rule: PromotionRule = {
      id: "r", slug: "r", name: "R", description: "", badgeText: null, priority: 1, active: true,
      startsAt: new Date(0), endsAt: new Date(8.64e15), mechanic, channels: [fulfilment], items, schedule: []
    };
    const price = new Map(products.map((product) => [product.id, BigInt(product.priceCents)]));
    const lines =
      mechanic.type === "free_delivery"
        ? [{ productId: SMASH, quantity: 1, unitPriceCents: 780000n, basePriceCents: 780000n }]
        : mechanic.type === "buy_x_get_y"
          ? [{ productId: PAPAS, quantity: 3, unitPriceCents: 350000n, basePriceCents: 350000n }]
          : items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPriceCents: price.get(item.productId)!, basePriceCents: price.get(item.productId)! }));
    const quote = quoteCart(lines, [rule], fulfilment, fee, { now: new Date(), timezone: "UTC" });
    const productTotal = lines.reduce((sum, line) => sum + line.unitPriceCents * BigInt(line.quantity), 0n);
    if (mechanic.type === "free_delivery") expect(row?.promoCents).toBe(quote.deliveryCents - (quote.promotion?.deliveryDiscountCents ?? 0n));
    else expect(row?.promoCents).toBe(productTotal - (quote.promotion?.productDiscountCents ?? 0n));
    expect(quote.promotion).not.toBeNull();
  });
});

describe("PromotionForm preview", () => {
  it("shows each orderable product's price with a percentage off when none is chosen (drafts left out)", () => {
    render(<PromotionForm defaults={defaults()} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    expect(rowsText()).toEqual(["Smash$ 7.800$ 6.630", "Papas$ 3.500$ 2.975"]);
  });

  it("follows the form live: changing the percentage changes the prices", async () => {
    render(<PromotionForm defaults={defaults()} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    const percent = screen.getByRole("spinbutton", { name: "Descuento (%)" });
    await userEvent.clear(percent);
    await userEvent.type(percent, "50");
    expect(rowsText()).toEqual(["Smash$ 7.800$ 3.900", "Papas$ 3.500$ 1.750"]);
    await userEvent.clear(percent);
    expect(previewTable().getByText("Completá los datos del descuento para ver los precios.")).toBeInTheDocument();
  });

  it("prices a combo against the sum of its products", () => {
    render(
      <PromotionForm
        defaults={defaults({ type: "fixed_price", fixedPrice: "9000", items: [{ productId: SMASH, quantity: "1" }, { productId: PAPAS, quantity: "1" }] })}
        deliveryFeeCents="120000"
        products={products}
        timezone="America/Argentina/Tucuman"
      />
    );
    expect(rowsText()).toEqual(["1× Smash + 1× Papas$ 11.300$ 9.000"]);
  });

  it("prices take-X-pay-Y for the full set of units", () => {
    render(<PromotionForm defaults={defaults({ type: "buy_x_get_y", items: [{ productId: PAPAS, quantity: "1" }] })} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    expect(rowsText()).toEqual(["3× Papas$ 10.500$ 7.000"]);
  });

  it("shows free delivery as the fee going to zero, and asks for a fee when there is none", () => {
    const { unmount } = render(<PromotionForm defaults={defaults({ type: "free_delivery", channels: ["delivery"] })} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    expect(rowsText()).toEqual(["Envío a domicilio$ 1.200$ 0"]);
    unmount();
    render(<PromotionForm defaults={defaults({ type: "free_delivery", channels: ["delivery"] })} deliveryFeeCents={null} products={products} timezone="America/Argentina/Tucuman" />);
    expect(previewTable().getByText("Configurá la tarifa de delivery para ver el ahorro.")).toBeInTheDocument();
  });

  it("adds products and windows as form rows", async () => {
    render(<PromotionForm defaults={defaults()} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    await userEvent.click(screen.getByRole("button", { name: "Agregar producto" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Producto 1" }), SMASH);
    expect(rowsText()).toEqual(["Smash$ 7.800$ 6.630"]);
    await userEvent.click(screen.getByRole("button", { name: "Agregar franja" }));
    expect(screen.getByRole("combobox", { name: "Día 1" })).toHaveValue("1");
    await userEvent.click(screen.getByRole("button", { name: "Quitar franja 1" }));
    expect(screen.queryByRole("combobox", { name: "Día 1" })).not.toBeInTheDocument();
  });
});
