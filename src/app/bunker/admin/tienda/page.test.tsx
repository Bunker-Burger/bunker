import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateStoreStatus, toPublicStoreStatus } from "@/domain/store-status";
import type { Catalog, StoreSettings } from "@/domain/types";
import { getStoreAdminView } from "@/server/store-admin";
import StoreAdminPage from "./page";

vi.mock("@/server/store-admin", () => ({ getStoreAdminView: vi.fn(), PAYMENT_METHODS: ["cash", "bank_transfer", "mercado_pago"] }));
vi.mock("./actions", () => ({
  setStoreStatusAction: vi.fn(),
  saveStoreContactAction: vi.fn(),
  addShiftAction: vi.fn(),
  deleteShiftAction: vi.fn(),
  savePaymentMethodAction: vi.fn()
}));

const viewMock = vi.mocked(getStoreAdminView);
const TZ = "America/Argentina/Tucuman";
// Tuesday 2026-10-13 21:00 local (UTC−3).
const NOW = new Date("2026-10-14T00:00:00Z");

const SECRETS = {
  MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-secret-access-token-123",
  SUPABASE_SECRET_KEY: "sb_secret_never_in_html_456",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-never-in-html-789"
};

function store(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    id: "s1",
    slug: "bunker-burger",
    name: "Búnker Burger",
    whatsappE164: "+5493815551234",
    timezone: TZ,
    currency: "ARS",
    statusOverride: "auto",
    isPublic: true,
    deliveryFeeCents: 120000n,
    businessHours: [
      { dayOfWeek: 2, opensAt: "19:30", closesAt: "00:00" },
      { dayOfWeek: 5, opensAt: "19:30", closesAt: "01:30" }
    ],
    paymentMethods: [
      { method: "cash", displayName: "Efectivo", instructions: "", enabled: true, sortOrder: 10 },
      { method: "bank_transfer", displayName: "Transferencia", instructions: "Alias bunker.burger", enabled: false, sortOrder: 20 }
    ],
    ...overrides
  };
}

function viewFor(settings: StoreSettings, mercadoPago = { available: false, reasons: ["config" as const] }) {
  const status = evaluateStoreStatus(settings, NOW);
  const catalog: Catalog = { store: settings, categories: [], products: [], promotions: [] };
  return {
    ok: true as const,
    value: {
      catalog,
      shifts: settings.businessHours.map((window, index) => ({ id: `0c000000-0000-4000-8000-00000000000${index}`, ...window })),
      status,
      publicStatus: toPublicStoreStatus(status),
      mercadoPago
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(SECRETS)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("/bunker/admin/tienda", () => {
  it("shows the status the server computed, with the current shift's closing time", async () => {
    viewMock.mockResolvedValue(viewFor(store()));
    render(await StoreAdminPage());
    const status = screen.getByRole("region", { name: "Estado ahora" });
    expect(status).toHaveTextContent("Abierto");
    expect(status).toHaveTextContent("según los horarios");
    expect(status).toHaveTextContent("cierra el miércoles 00:00");
    expect(within(status).getByRole("combobox", { name: "Pedidos" })).toHaveValue("auto");
  });

  it("explains that orders stay disabled without a fee, and shows the next shift", async () => {
    viewMock.mockResolvedValue(viewFor(store({ deliveryFeeCents: null, statusOverride: "closed" })));
    render(await StoreAdminPage());
    expect(screen.getByRole("region", { name: "Estado ahora" })).toHaveTextContent("Cerrado");
    expect(screen.getByText(/necesitan una tarifa de delivery configurada/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Tarifa de delivery" })).toHaveValue(null);
  });

  it("lists shifts, marking the ones that cross midnight, each with its delete button", async () => {
    viewMock.mockResolvedValue(viewFor(store()));
    render(await StoreAdminPage());
    const shifts = within(screen.getByRole("list", { name: "Turnos" })).getAllByRole("listitem");
    expect(shifts.map((item) => item.textContent?.replace("✕", "").trim())).toEqual(["Martes 19:30 a 00:00Cruza medianoche", "Viernes 19:30 a 01:30Cruza medianoche"]);
    expect(screen.getByRole("button", { name: "Eliminar turno del Viernes 19:30" })).toBeInTheDocument();
  });

  it("offers the three payment methods, including ones the store never configured", async () => {
    viewMock.mockResolvedValue(viewFor(store()));
    render(await StoreAdminPage());
    const methods = screen.getAllByRole("article").map((article) => within(article).getByRole("heading").textContent);
    expect(methods).toEqual(["Efectivo", "Transferencia", "Mercado Pago"]);
    expect(screen.getByRole("article", { name: "Mercado Pago" })).toHaveTextContent("Deshabilitado");
    expect(screen.getByText(/Mercado Pago: no se ofrece a los clientes ahora \(falta configurarlo en el servidor\)/)).toBeInTheDocument();
  });

  it("previews what customers see: the storefront sentence, fee, WhatsApp and enabled methods only", async () => {
    viewMock.mockResolvedValue(viewFor(store()));
    render(await StoreAdminPage());
    const publicView = screen.getByRole("region", { name: "Lo que ve el cliente" });
    expect(publicView).toHaveTextContent("El local está abierto hasta las");
    expect(publicView).toHaveTextContent("$ 1.200");
    expect(publicView).toHaveTextContent("+5493815551234");
    expect(publicView).toHaveTextContent("Efectivo exacto — Tené el importe justo al recibir o retirar");
    expect(publicView).not.toHaveTextContent("Transferencia");
  });

  it.each([
    [false, ["Efectivo exacto"]],
    [true, ["Mercado Pago", "Efectivo exacto"]]
  ])("lists Mercado Pago to customers only while it is available (available: %s), keeping the saved preference", async (available, offered) => {
    const settings = store({
      paymentMethods: [
        { method: "cash", displayName: "Efectivo", instructions: "", enabled: true, sortOrder: 10 },
        { method: "mercado_pago", displayName: "Mercado Pago", instructions: "", enabled: true, sortOrder: 30 }
      ]
    });
    viewMock.mockResolvedValue(viewFor(settings, available ? { available: true, reasons: [] } : { available: false, reasons: ["config"] }));
    render(await StoreAdminPage());
    const publicView = screen.getByRole("region", { name: "Lo que ve el cliente" });
    expect(within(publicView).getAllByRole("listitem").map((item) => item.querySelector("strong")?.textContent)).toEqual(offered);
    const method = screen.getByRole("article", { name: "Mercado Pago" });
    expect(within(method).getByRole("checkbox", { name: "Habilitado" })).toBeChecked();
  });

  it("shows transfers as the checkout does: ask for the details on WhatsApp, never the stored text", async () => {
    viewMock.mockResolvedValue(
      viewFor(
        store({
          paymentMethods: [{ method: "bank_transfer", displayName: "Transferencia", instructions: "Alias bunker.burger", enabled: true, sortOrder: 20 }]
        })
      )
    );
    render(await StoreAdminPage());
    const publicView = screen.getByRole("region", { name: "Lo que ve el cliente" });
    expect(publicView).toHaveTextContent("Transferencia — Pedí el alias por WhatsApp y enviá el comprobante por ese chat");
    expect(publicView).not.toHaveTextContent("bunker.burger");
  });

  it("does not suggest writing an alias or CBU in the instructions", async () => {
    viewMock.mockResolvedValue(viewFor(store()));
    render(await StoreAdminPage());
    const transfer = screen.getByRole("article", { name: "Transferencia" });
    const hint = within(transfer).getByText(/Texto opcional y público/);
    expect(hint).toHaveTextContent("Nunca alias, CBU, CVU ni números de cuenta");
    expect(hint.textContent).not.toMatch(/por ejemplo alias|alias o CBU/);
  });

  it("never puts server secrets in the HTML", async () => {
    viewMock.mockResolvedValue(viewFor(store(), { available: true, reasons: [] }));
    const { container } = render(await StoreAdminPage());
    for (const secret of Object.values(SECRETS)) expect(container.innerHTML).not.toContain(secret);
    expect(container.innerHTML).not.toMatch(/ACCESS_TOKEN|SECRET_KEY|SERVICE_ROLE/);
  });

  it("says so when the configuration cannot be read, without details", async () => {
    viewMock.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "connect ECONNREFUSED db.internal" } });
    render(await StoreAdminPage());
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar la configuración.");
    expect(document.body.textContent).not.toContain("ECONNREFUSED");
  });
});
