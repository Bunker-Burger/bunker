import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog, Product } from "@/domain/types";
import { getCatalogAdminView } from "@/server/catalog-admin";
import CatalogAdminPage from "./page";

vi.mock("@/server/catalog-admin", () => ({ getCatalogAdminView: vi.fn() }));
vi.mock("./actions", () => ({
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
  moveCategoryAction: vi.fn(),
  moveProductAction: vi.fn()
}));

const viewMock = vi.mocked(getCatalogAdminView);

const product = (overrides: Partial<Product>): Product => ({
  id: "p",
  slug: "p",
  name: "P",
  type: "burger",
  categoryId: "c-burgers",
  description: "",
  priceCents: 780000n,
  imageUrl: null,
  published: true,
  featured: false,
  inStock: true,
  optionGroups: [],
  ...overrides
});

const catalog = {
  store: {} as Catalog["store"],
  categories: [
    { id: "c-burgers", slug: "hamburguesas", name: "Hamburguesas", type: "burger", sortOrder: 10, visible: true },
    { id: "c-secret", slug: "secretas", name: "Secretas", type: "burger", sortOrder: 15, visible: false },
    { id: "c-drinks", slug: "bebidas", name: "Bebidas", type: "beverage", sortOrder: 40, visible: true }
  ],
  products: [
    product({ id: "p1", name: "Smash Búnker Doble", featured: true, imageUrl: "https://x.supabase.co/a.webp", imageFocalPoint: { x: 20, y: 80 } }),
    product({ id: "p2", name: "Burger del mes", published: false, priceCents: 0n }),
    product({ id: "p3", name: "Pulled Pork", inStock: false }),
    product({ id: "p4", name: "Gaseosa", type: "beverage", categoryId: "c-drinks" })
  ],
  promotions: []
} satisfies Catalog;

const page = async (tipo?: string) => render(await CatalogAdminPage({ searchParams: Promise.resolve(tipo ? { tipo } : {}) }));

beforeEach(() => {
  vi.clearAllMocks();
  viewMock.mockResolvedValue({ ok: true, value: { catalog, optionGroups: [] } });
});

describe("/bunker/admin/catalogo", () => {
  it("shows the four product-type tabs, Hamburguesas by default", async () => {
    await page();
    const tabs = within(screen.getByRole("navigation", { name: "Tipos de producto" })).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Hamburguesas", "Sándwiches", "Papas", "Bebidas"]);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(tabs[3]).toHaveAttribute("href", "/bunker/admin/catalogo?tipo=bebidas");
  });

  it("lists the tab's categories, hidden ones included, with product state and edit links", async () => {
    await page("hamburguesas");
    const burgers = screen.getByRole("article", { name: "Hamburguesas" });
    expect(within(burgers).getByRole("link", { name: "Smash Búnker Doble" })).toHaveAttribute("href", "/bunker/admin/catalogo/productos/p1");
    expect(within(burgers).getByText("Borrador")).toBeInTheDocument();
    expect(within(burgers).getByText("Sin stock")).toBeInTheDocument();
    expect(within(burgers).getByText("Destacado")).toBeInTheDocument();
    expect(within(burgers).getByRole("link", { name: "Nuevo producto" })).toHaveAttribute("href", "/bunker/admin/catalogo/productos/nuevo?categoria=c-burgers");
    expect(screen.getByRole("article", { name: "Secretas" })).toHaveTextContent("Oculta");
    expect(screen.queryByRole("link", { name: "Gaseosa" })).not.toBeInTheDocument();
  });

  it("offers reordering with named buttons, none past the ends", async () => {
    await page();
    const products = screen.getByRole("list", { name: "Productos de Hamburguesas" });
    expect(within(products).queryByRole("button", { name: "Subir Smash Búnker Doble" })).not.toBeInTheDocument();
    expect(within(products).getByRole("button", { name: "Bajar Smash Búnker Doble" })).toBeInTheDocument();
    expect(within(products).queryByRole("button", { name: "Bajar Pulled Pork" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bajar Hamburguesas" })).toBeInTheDocument();
  });

  it("creates categories only of the open tab's type", async () => {
    await page("bebidas");
    const kind = document.querySelector<HTMLInputElement>('input[name="kind"]');
    expect(kind?.value).toBe("drink");
    expect(screen.getByRole("heading", { level: 2, name: "Bebidas" })).toBeInTheDocument();
  });

  it("shows no orders, revenue or invented metrics", async () => {
    await page();
    expect(document.body.textContent).not.toMatch(/pedidos|ventas|factura|ingresos|clientes|kpi|visitas/i);
  });

  it("says so when the catalog cannot be read, without details", async () => {
    viewMock.mockResolvedValue({ ok: false, error: { code: "unauthorized", message: "auth.getUser: secret detail" } });
    await page();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el catálogo.");
    expect(document.body.textContent).not.toContain("secret detail");
  });
});
