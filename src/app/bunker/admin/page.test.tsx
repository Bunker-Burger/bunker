import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fixtureProducts, categories as fixtureCategories } from "@/data/catalog";
import { evaluateStoreStatus, toPublicStoreStatus } from "@/domain/store-status";
import type { Catalog, PromotionRule, StoreSettings } from "@/domain/types";
import { getCatalogAdminView } from "@/server/catalog-admin";
import { getStoreAdminView } from "@/server/store-admin";
import { reorderCategoriesAction, reorderProductsAction, saveProductAction } from "./catalogo/actions";
import { setStoreStatusAction } from "./tienda/actions";
import AdminHomePage from "./page";

vi.mock("@/server/catalog-admin", () => ({ getCatalogAdminView: vi.fn() }));
vi.mock("@/server/store-admin", () => ({ getStoreAdminView: vi.fn(), PAYMENT_METHODS: ["cash", "bank_transfer", "mercado_pago"] }));
vi.mock("./catalogo/actions", () => ({
  saveProductAction: vi.fn(async () => ({ status: "success", message: "Producto guardado." })),
  reorderCategoriesAction: vi.fn(),
  reorderProductsAction: vi.fn(),
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  deleteCategoryAction: vi.fn()
}));
vi.mock("./tienda/actions", () => ({
  setStoreStatusAction: vi.fn(),
  saveStoreContactAction: vi.fn(),
  addShiftAction: vi.fn(),
  deleteShiftAction: vi.fn(),
  savePaymentMethodAction: vi.fn(),
  reorderPaymentMethodsAction: vi.fn()
}));
vi.mock("./promociones/actions", () => ({ setPromotionActiveAction: vi.fn(), reorderPromotionsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/bunker/admin" }));

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
    expect(within(products).getByRole("textbox", { name: "Precio de Smash Búnker Doble" })).toHaveValue("7.800");
    expect(within(products).getByRole("checkbox", { name: "Smash Búnker Doble disponible" })).toBeChecked();
    expect(within(products).getByRole("checkbox", { name: "Pulled Pork Búnker disponible" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "Costo de delivery" })).toHaveValue("1.200");

    expect(screen.getByRole("checkbox", { name: "Martes de Smash activa" })).toBeChecked();

    // Category pills narrow the price list.
    await user.click(screen.getByRole("button", { name: "Bebidas" }));
    expect(within(products).queryByRole("textbox", { name: "Precio de Smash Búnker Doble" })).toBeNull();
    expect(within(products).getByRole("textbox", { name: "Precio de Limonada de la Casa" })).toBeInTheDocument();

    expect(screen.queryByText(/pedidos hoy|facturaci|ventas|ingresos|clientes|kpi/i)).not.toBeInTheDocument();

    // Everything lives in the panel now; the public menu stays one click away.
    expect(screen.queryByRole("navigation", { name: "Administración" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver la carta como cliente" })).toHaveAttribute("href", "/");
  });

  it("a quick price change sends the rest of the product exactly as stored", async () => {
    const user = userEvent.setup();
    render(await AdminHomePage());

    const price = screen.getByRole("textbox", { name: "Precio de Smash Búnker Doble" });
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

  it("the store switch closes an open store and opens a closed one", async () => {
    const user = userEvent.setup();
    const { setStoreStatusAction } = await import("./tienda/actions");
    vi.mocked(setStoreStatusAction).mockResolvedValue({ status: "success", message: "ok" });
    render(await AdminHomePage());

    const storeSwitch = screen.getByRole("checkbox", { name: "Local abierto" });
    const wasOpen = (storeSwitch as HTMLInputElement).checked;
    await user.click(storeSwitch);
    expect(vi.mocked(setStoreStatusAction).mock.calls.at(-1)![1].get("statusOverride")).toBe(wasOpen ? "closed" : "open");
  });

  it("orders the menu's sections and a category's products from the panel (no catalog screen)", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderCategoriesAction).mockResolvedValue({ status: "success", message: "ok" });
    vi.mocked(reorderProductsAction).mockResolvedValue({ status: "success", message: "ok" });
    render(await AdminHomePage());

    const pills = screen.getByRole("group", { name: "Categorías de la carta, en su orden" });
    const first = within(pills).getAllByRole("button", { name: /^Mover / })[0]!;
    first.focus();
    await user.keyboard("{ArrowRight}");
    const sentCategories = vi.mocked(reorderCategoriesAction).mock.calls.at(-1)![1].getAll("categoryId");
    const sorted = [...fixtureCategories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) => category.id);
    expect(sentCategories).toEqual([sorted[1], sorted[0], ...sorted.slice(2)]);

    // Choosing a category opens its editor and lets its products be dragged into order.
    const burgers = fixtureCategories.find((category) => category.type === "burger")!;
    await user.click(within(pills).getByRole("button", { name: burgers.name }));
    expect(screen.getByRole("textbox", { name: `Nombre de ${burgers.name}` })).toHaveValue(burgers.name);
    const handles = within(screen.getByRole("list", { name: "Productos" })).getAllByRole("button", { name: /^Mover / });
    handles[0]!.focus();
    await user.keyboard("{ArrowDown}");
    const sentProducts = vi.mocked(reorderProductsAction).mock.calls.at(-1)![1];
    expect(sentProducts.get("categoryId")).toBe(burgers.id);
    const burgerIds = fixtureProducts.filter((product) => product.categoryId === burgers.id).map((product) => product.id);
    expect(sentProducts.getAll("productId")).toEqual([burgerIds[1], burgerIds[0], ...burgerIds.slice(2)]);
  });

  it("shows a promotion's photo, cropped where it was framed, instead of the flame (issue #54)", async () => {
    const framed = { ...promotion, imageUrl: "https://cdn.test/catalog/s1/promotions/martes.webp", imageFocalPoint: { x: 30, y: 70 } };
    const view = (await vi.mocked(getStoreAdminView)()) as unknown as { value: Record<string, unknown> };
    vi.mocked(getStoreAdminView).mockResolvedValue({ ok: true, value: { ...view.value, catalog: { ...catalog, promotions: [framed] } } } as never);
    const { container } = render(await AdminHomePage());
    const photo = container.querySelector('#lista-promociones img[src="https://cdn.test/catalog/s1/promotions/martes.webp"]');
    expect(photo).toHaveStyle({ objectPosition: "30% 70%" });
  });

  it("says so when the panel cannot be read", async () => {
    vi.mocked(getCatalogAdminView).mockResolvedValue({ ok: false, error: { code: "unavailable" } } as never);
    render(await AdminHomePage());
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el panel");
  });

  describe("store settings, formerly the Tienda screen (issue #54)", () => {
    const SECRETS = {
      MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-secret-access-token-123",
      SUPABASE_SECRET_KEY: "sb_secret_never_in_html_456",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-never-in-html-789"
    };
    beforeEach(() => {
      for (const [key, value] of Object.entries(SECRETS)) vi.stubEnv(key, value);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("shows WhatsApp, opening hours and payment methods in the panel", async () => {
      const view = (await vi.mocked(getStoreAdminView)()) as unknown as { value: Record<string, unknown> };
      vi.mocked(getStoreAdminView).mockResolvedValue({
        ok: true,
        value: { ...view.value, shifts: [{ id: "sh1", dayOfWeek: 4, opensAt: "20:00", closesAt: "00:30" }] }
      } as never);
      render(await AdminHomePage());
      expect(screen.getByRole("textbox", { name: "WhatsApp del local" })).toHaveValue("+5493815551234");
      // Collapsed by default: title, summary and arrow; the week is inside.
      const hours = screen.getByRole("heading", { name: "Horarios" }).closest("details")!;
      expect(hours).not.toHaveAttribute("open");
      expect(hours.querySelector("summary")).toHaveTextContent("Abierto 1 día · cerrado lun, mar, mié, vie, sáb, dom");
      const days = within(screen.getByRole("list", { name: "Turnos", hidden: true })).getAllByRole("listitem", { hidden: true });
      expect(days.map((day) => day.textContent)).toEqual([
        "LunesCerrado",
        "MartesCerrado",
        "MiércolesCerrado",
        "Jueves20:00 – 00:30 +1",
        "ViernesCerrado",
        "SábadoCerrado",
        "DomingoCerrado"
      ]);
      // Every settings card starts collapsed, with what matters in its summary.
      for (const title of ["Delivery y WhatsApp", "Horarios", "Medios de pago"]) {
        expect(screen.getByRole("heading", { name: title }).closest("details")).not.toHaveAttribute("open");
      }
      expect(screen.getByRole("heading", { name: "Delivery y WhatsApp" }).closest("summary")).toHaveTextContent("+5493815551234");
      expect(screen.getByRole("heading", { name: "Medios de pago" }).closest("summary")).toHaveTextContent("Ninguno habilitado");
      const methods = screen.getByRole("list", { name: "Medios de pago" });
      expect(within(methods).getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual([
        "Efectivo habilitado",
        "Transferencia habilitado",
        "Mercado Pago habilitado"
      ]);
    });

    it("changes the store mode from the panel, including following the opening hours", async () => {
      vi.mocked(setStoreStatusAction).mockResolvedValue({ status: "success", message: "ok" });
      render(await AdminHomePage());
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Modo" }), "auto");
      expect(vi.mocked(setStoreStatusAction).mock.calls.at(-1)![1].get("statusOverride")).toBe("auto");
    });

    it("never puts server secrets in the HTML", async () => {
      const { container } = render(await AdminHomePage());
      for (const secret of Object.values(SECRETS)) expect(container.innerHTML).not.toContain(secret);
      expect(container.innerHTML).not.toMatch(/ACCESS_TOKEN|SECRET_KEY|SERVICE_ROLE/);
    });
  });
});
