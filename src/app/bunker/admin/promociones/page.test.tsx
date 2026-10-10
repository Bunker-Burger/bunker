import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog, PromotionRule } from "@/domain/types";
import { getStoreAdminView } from "@/server/store-admin";
import PromotionsAdminPage from "./page";

vi.mock("@/server/store-admin", () => ({ getStoreAdminView: vi.fn() }));
vi.mock("./actions", () => ({ setPromotionActiveAction: vi.fn(), movePromotionAction: vi.fn(), deletePromotionAction: vi.fn() }));

const viewMock = vi.mocked(getStoreAdminView);
const DAY = 86_400_000;

function rule(name: string, priority: number, overrides: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id: `0d000000-0000-4000-8000-0000000000${String(priority).padStart(2, "0")}`,
    slug: name.toLowerCase(),
    name,
    description: "",
    badgeText: null,
    priority,
    active: true,
    startsAt: new Date(Date.now() - DAY),
    endsAt: new Date(Date.now() + DAY),
    mechanic: { type: "percent_off", percentOff: 10 },
    channels: ["delivery", "pickup"],
    items: [],
    schedule: [],
    ...overrides
  };
}

function view(promotions: PromotionRule[]) {
  const catalog = {
    store: { timezone: "America/Argentina/Tucuman" },
    categories: [],
    products: [{ id: "p1", name: "Smash" }],
    promotions
  } as unknown as Catalog;
  return { ok: true as const, value: { catalog } } as Awaited<ReturnType<typeof getStoreAdminView>>;
}

beforeEach(() => vi.clearAllMocks());

describe("/bunker/admin/promociones", () => {
  it("lists promotions in the order they are tried (highest priority first) with where each one stands", async () => {
    viewMock.mockResolvedValue(
      view([
        rule("Baja", 1, { active: false }),
        rule("Alta", 9),
        rule("Futura", 5, { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 2 * DAY) }),
        rule("Vieja", 3, { startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - DAY) })
      ])
    );
    render(await PromotionsAdminPage());
    const items = within(screen.getByRole("list", { name: "Promociones por prioridad" })).getAllByRole("listitem");
    expect(items.map((item) => within(item).getAllByRole("link")[0]?.textContent)).toEqual(["Alta", "Futura", "Vieja", "Baja"]);
    expect(items[0]).toHaveTextContent("En vigencia ahora");
    expect(items[1]).toHaveTextContent("Programada");
    expect(items[2]).toHaveTextContent("Vencida");
    expect(items[3]).toHaveTextContent("Pausada");
    expect(within(items[3]!).getByRole("button", { name: "Reanudar" })).toBeInTheDocument();
    expect(within(items[0]!).getByRole("button", { name: "Pausar" })).toBeInTheDocument();
  });

  it("explains each mechanic from its parameters and lists products and windows", async () => {
    viewMock.mockResolvedValue(
      view([
        rule("Combo", 2, {
          mechanic: { type: "fixed_price", fixedPriceCents: 900000n },
          items: [{ productId: "p1", quantity: 2 }],
          schedule: [{ dayOfWeek: 2, startsAt: "19:00:00", endsAt: "23:30:00" }],
          channels: ["pickup"]
        })
      ])
    );
    render(await PromotionsAdminPage());
    const item = screen.getByRole("listitem");
    expect(item.textContent?.replace(/ /g, " ")).toContain("Combo a $ 9.000");
    expect(item).toHaveTextContent("Mar 19:00–23:30");
    expect(item).toHaveTextContent("2× Smash");
    expect(item).toHaveTextContent("retiro");
  });

  it("offers moving only where there is a neighbour", async () => {
    viewMock.mockResolvedValue(view([rule("A", 2), rule("B", 1)]));
    render(await PromotionsAdminPage());
    expect(screen.queryByRole("button", { name: "Subir A" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bajar A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bajar B" })).not.toBeInTheDocument();
  });

  it("shows no orders, sales or invented metrics", async () => {
    viewMock.mockResolvedValue(view([rule("A", 1)]));
    render(await PromotionsAdminPage());
    expect(document.body.textContent).not.toMatch(/ventas|factura|ingresos|kpi|clientes atendidos|usos/i);
  });
});
