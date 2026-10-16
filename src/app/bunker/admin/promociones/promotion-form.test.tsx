import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { quoteCart } from "@/domain/pricing";
import type { PromotionRule } from "@/domain/types";
import type { AdminFormState } from "../form-state";
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
    await userEvent.click(screen.getByRole("button", { name: "Horarios distintos por día" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar franja" }));
    expect(screen.getByRole("combobox", { name: "Día 1" })).toHaveValue("1");
    await userEvent.click(screen.getByRole("button", { name: "Quitar franja 1" }));
    expect(screen.queryByRole("combobox", { name: "Día 1" })).not.toBeInTheDocument();
  });

  it("the day chips send one window per marked day with the same hours (issue #54)", async () => {
    const action = vi.fn<(state: AdminFormState, form: FormData) => Promise<AdminFormState>>(async () => ({ status: "idle", message: null }));
    render(<PromotionForm action={action} defaults={defaults()} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    await userEvent.click(screen.getByRole("button", { name: "Jueves" }));
    await userEvent.click(screen.getByRole("button", { name: "Domingo" }));
    expect(screen.getByRole("button", { name: "Jueves" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Crear promoción" }));

    const sent = action.mock.calls.at(-1)![1];
    expect(sent.getAll("scheduleDay")).toEqual(["4", "0"]);
    expect(sent.getAll("scheduleStart")).toEqual(["20:00", "20:00"]);
    expect(sent.getAll("scheduleEnd")).toEqual(["23:30", "23:30"]);
  });

  it("an existing schedule with different hours per day opens in the per-day list", () => {
    render(
      <PromotionForm
        defaults={defaults({ schedule: [{ dayOfWeek: "2", startsAt: "19:00", endsAt: "23:00" }, { dayOfWeek: "5", startsAt: "20:00", endsAt: "01:00" }] })}
        deliveryFeeCents="120000"
        products={products}
        timezone="America/Argentina/Tucuman"
      />
    );
    expect(screen.getByRole("combobox", { name: "Día 2" })).toHaveValue("5");
    expect(screen.queryByRole("group", { name: "Días de aplicación" })).toBeNull();
  });

  it("a suggested tag fills the badge; Personalizado opens a free field", async () => {
    const action = vi.fn<(state: AdminFormState, form: FormData) => Promise<AdminFormState>>(async () => ({ status: "idle", message: null }));
    render(<PromotionForm action={action} defaults={defaults()} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    await userEvent.click(screen.getByRole("button", { name: "30% OFF" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear promoción" }));
    expect((action.mock.calls.at(-1)![1]).get("badgeText")).toBe("30% OFF");

    await userEvent.click(screen.getByRole("button", { name: "Personalizado" }));
    const custom = screen.getByRole("textbox", { name: "Tag personalizado" });
    await userEvent.clear(custom);
    await userEvent.type(custom, "Búnker Fest");
    await userEvent.click(screen.getByRole("button", { name: "Crear promoción" }));
    expect((action.mock.calls.at(-1)![1]).get("badgeText")).toBe("Búnker Fest");
  });

  it("opens with the photo card, as in the capture, and sends the file with the promotion (issue #54)", async () => {
    const action = vi.fn<(state: AdminFormState, form: FormData) => Promise<AdminFormState>>(async () => ({ status: "idle", message: null }));
    const photo = { url: null, maxBytes: 5 * 1024 * 1024, minSide: 320, maxSide: 4096 };
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const { container } = render(<PromotionForm action={action} defaults={defaults()} deliveryFeeCents="120000" photo={photo} products={products} timezone="America/Argentina/Tucuman" />);
    expect(container.querySelector("fieldset legend")).toHaveTextContent("Foto de la promo");
    const file = new File(["png"], "banner.png", { type: "image/png" });
    const input = screen.getByLabelText<HTMLInputElement>("Subir foto de la promo");
    await userEvent.upload(input, file);
    // jsdom's FormData drops the file's name across realms, so check the field the form submits.
    expect(input).toHaveAttribute("name", "image");
    expect(input.form).toBe(screen.getByRole("button", { name: "Crear promoción" }).closest("form"));
    expect(input.files?.[0]?.name).toBe("banner.png");
    expect(screen.queryByLabelText("Quitar la foto al guardar")).not.toBeInTheDocument();
  });

  it("offers removing a stored photo", async () => {
    const action = vi.fn<(state: AdminFormState, form: FormData) => Promise<AdminFormState>>(async () => ({ status: "idle", message: null }));
    const photo = { url: "https://cdn.test/catalog/s1/promotions/p.webp", maxBytes: 5 * 1024 * 1024, minSide: 320, maxSide: 4096 };
    render(<PromotionForm action={action} defaults={defaults()} deliveryFeeCents="120000" photo={photo} products={products} timezone="America/Argentina/Tucuman" />);
    await userEvent.click(screen.getByLabelText("Quitar la foto al guardar"));
    await userEvent.click(screen.getByRole("button", { name: "Crear promoción" }));
    expect((action.mock.calls.at(-1)![1]).get("removeImage")).toBe("true");
  });

  it("keeps a stored weekly window when saving without touching it", async () => {
    const action = vi.fn<(state: AdminFormState, form: FormData) => Promise<AdminFormState>>(async () => ({ status: "idle", message: null }));
    render(<PromotionForm action={action} defaults={defaults({ schedule: [{ dayOfWeek: "2", startsAt: "18:00", endsAt: "23:59" }] })} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    await userEvent.click(screen.getByRole("button", { name: "Crear promoción" }));
    const sent = action.mock.calls.at(-1)![1];
    expect([sent.getAll("scheduleDay"), sent.getAll("scheduleStart"), sent.getAll("scheduleEnd")]).toEqual([["2"], ["18:00"], ["23:59"]]);
  });

  it("previews the banner and the section card once there is a photo (issue #54)", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const photo = { url: null, maxBytes: 5 * 1024 * 1024, minSide: 320, maxSide: 4096 };
    render(<PromotionForm defaults={defaults()} deliveryFeeCents="120000" photo={photo} products={products} timezone="America/Argentina/Tucuman" />);
    const preview = screen.getByRole("region", { name: "Así se verá en la carta" });
    // Without a photo the promotion is previewed with the tile and its icon.
    expect(within(preview).getByText(/Sin foto se muestra con un ícono/)).toBeInTheDocument();
    expect(within(preview).getByRole("region", { name: "Vista previa del banner" }).querySelector(".promo-tile")).not.toBeNull();

    await userEvent.upload(screen.getByLabelText("Subir foto de la promo"), new File(["png"], "banner.png", { type: "image/png" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Nombre de la promoción/ }), "Jueves de birra");
    expect(await within(preview).findByRole("region", { name: "Vista previa del banner" })).toBeInTheDocument();
    expect(within(preview).getAllByRole("heading", { name: "Jueves de birra" })).toHaveLength(2);
  });

  it("previews a combo without a photo as its card of the Combos section (issue #54)", async () => {
    render(
      <PromotionForm
        defaults={defaults({ type: "fixed_price", fixedPrice: "9000", items: [{ productId: SMASH, quantity: "1" }, { productId: PAPAS, quantity: "1" }] })}
        deliveryFeeCents="120000"
        products={products}
        timezone="America/Argentina/Tucuman"
      />
    );
    await userEvent.type(screen.getByRole("textbox", { name: /Nombre de la promoción/ }), "Combo Smash");
    const preview = screen.getByRole("region", { name: "Así se verá en la carta" });
    const section = await within(preview).findByRole("region", { name: "Combos" });
    expect(within(section).getByRole("heading", { name: "Combo Smash" })).toBeInTheDocument();
    expect(within(section).getByText("1× Smash + 1× Papas")).toBeInTheDocument();
    expect(within(section).getByText("$ 9.000")).toBeInTheDocument();
    expect(within(section).getByText("$ 11.300", { selector: "s" })).toBeInTheDocument();
  });

  it("previews a free-delivery promotion without a photo too, as the banner with its tile", () => {
    render(<PromotionForm defaults={defaults({ type: "free_delivery", channels: ["delivery"] })} deliveryFeeCents="120000" products={products} timezone="America/Argentina/Tucuman" />);
    const preview = screen.getByRole("region", { name: "Así se verá en la carta" });
    expect(within(preview).getByRole("region", { name: "Vista previa del banner" }).querySelector(".promo-tile")).not.toBeNull();
  });
});
