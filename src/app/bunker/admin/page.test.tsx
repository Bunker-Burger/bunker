import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { products as fixtureProducts, categories as fixtureCategories } from "@/data/catalog";
import { evaluateStoreStatus, toPublicStoreStatus } from "@/domain/store-status";
import type { Catalog, PromotionRule, StoreSettings } from "@/domain/types";
import { getCatalogAdminView } from "@/server/catalog-admin";
import { getStoreAdminView } from "@/server/store-admin";
import { saveProductAction } from "./catalogo/actions";
import AdminHomePage from "./page";

vi.mock("@/server/catalog-admin", () => ({ getCatalogAdminView: vi.fn() }));
vi.mock("@/server/store-admin", () => ({ getStoreAdminView: vi.fn() }));
vi.mock("./catalogo/actions", () => ({ saveProductAction: vi.fn(async () => ({ status: "success", message: "Producto guardado." })) }));
vi.mock("./tienda/actions", () => ({ setStoreStatusAction: vi.fn(), saveStoreContactAction: vi.fn() }));
vi.mock("./promociones/actions", () => ({ setPromotionActiveAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const store = {
  id: "s1",
  slug: "bunker-burger",
  name: "Búnker Burger",
  whatsappE164: "+5493815551234",
  timezone: "America/Argentina/Tucuman",
  currency: "ARS",
  statusOverride: "auto",
  isPublic: true,
  deliveryFeeCents: 120000n,
  businessHours: [],
  paymentMethods: []
} as unknown as StoreSettings;
const promotion = {
  id: "0d000000-0000-4000-8000-000000000009",
  slug: "martes",
  name: "Martes de Smash",
  description: "",
  badgeText: "15% OFF",
  priority: 9,
  active: true,
  startsAt: new Date(Date.now() - 86_400_000),
  endsAt: new Date(Date.now() + 86_400_000),
  mechanic: { type: "percent_off", percentOff: 15 },
  channels: ["delivery", "pickup"],
  items: [],
  schedule: []
} as unknown as PromotionRule;
const catalog = { store, categories: fixtureCategories, products: fixtureProducts, promotions: [promotion] } as unknown as Catalog;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCatalogAdminView).mockResolvedValue({ ok: true, value: { catalog, optionGroups: [] } } as never);
  const status = evaluateStoreStatus(store, new Date());
  vi.mocked(getStoreAdminView).mockResolvedValue({
    ok: true,
    value: { catalog, shifts: [], status, publicStatus: toPublicStoreStatus(status), mercadoPago: { available: false, reasons: ["config"] } }
  } as never);
});

describe("/bunker/admin (panel de control, issue #54)", () => {
  it("shows store status, shortcuts, prices and stock, promotions and the delivery fee, without invented metrics", async () => {
    const user = userEvent.setup();
    render(await AdminHomePage());

    expect(screen.getByRole("heading", { name: "Panel administrativo" })).toBeInTheDocument();
    expect(screen.getByText("Estado del local")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Producto" })).toHaveAttribute("href", "/bunker/admin/catalogo/productos/nuevo");
    expect(screen.getByRole("link", { name: "Promoción" })).toHaveAttribute("href", "/bunker/admin/promociones/nueva");
    expect(screen.getByRole("heading", { name: "Gestión de precios & stock" })).toBeInTheDocument();

    const products = screen.getByRole("list", { name: "Productos" });
    expect(within(products).getByRole("spinbutton", { name: "Precio de Smash Búnker Doble" })).toHaveValue(7800);
    expect(within(products).getByRole("checkbox", { name: "Smash Búnker Doble disponible" })).toBeChecked();
    expect(within(products).getByRole("checkbox", { name: "Pulled Pork Búnker disponible" })).not.toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Costo de delivery" })).toHaveValue(1200);

    await user.click(screen.getByRole("button", { name: /Promociones/ }));
    expect(screen.getByRole("checkbox", { name: "Martes de Smash activa" })).toBeChecked();

    expect(screen.queryByText(/pedidos hoy|facturaci|ventas|ingresos|clientes|kpi/i)).not.toBeInTheDocument();
  });

  it("a quick price change sends the rest of the product exactly as stored", async () => {
    const user = userEvent.setup();
    render(await AdminHomePage());

    const price = screen.getByRole("spinbutton", { name: "Precio de Smash Búnker Doble" });
    await user.clear(price);
    await user.type(price, "8100");
    await user.click(screen.getByRole("button", { name: "Guardar precio de Smash Búnker Doble" }));

    const form = vi.mocked(saveProductAction).mock.calls.at(-1)![1];
    const smash = fixtureProducts.find((product) => product.slug === "smash-bunker-doble")!;
    expect(form.get("productId")).toBe(smash.id);
    expect(form.get("price")).toBe("8100");
    expect(form.get("name")).toBe(smash.name);
    expect(form.get("description")).toBe(smash.description);
    expect(form.get("inStock")).toBe("true");
    expect(form.get("featured")).toBe("true");
    expect(form.get("published")).toBe("true");
    expect(form.getAll("optionGroup")).toEqual(smash.optionGroups.map((group) => group.id));
    for (const group of smash.optionGroups) expect(form.getAll(`default:${group.id}`)).toEqual(group.defaultOptionIds);
  });

  it("turning a product off saves it without stock and nothing else changed", async () => {
    const user = userEvent.setup();
    render(await AdminHomePage());

    await user.click(screen.getByRole("checkbox", { name: "Smash Búnker Doble disponible" }));

    const form = vi.mocked(saveProductAction).mock.calls.at(-1)![1];
    expect(form.get("inStock")).toBeNull();
    expect(form.get("price")).toBe("7800");
    expect(form.get("published")).toBe("true");
  });

  it("says so when the panel cannot be read", async () => {
    vi.mocked(getCatalogAdminView).mockResolvedValue({ ok: false, error: { code: "unavailable" } } as never);
    render(await AdminHomePage());
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el panel");
  });
});
