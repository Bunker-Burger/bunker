import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogAdminDependencies, createCategory, deleteProduct, saveProduct } from "@/server/catalog-admin";
import { createCategoryAction, deleteProductAction, saveProductAction } from "./actions";
import { IDLE_FORM_STATE } from "./form-state";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));
vi.mock("@/server/catalog", () => ({ CATALOG_CACHE_TAG: "catalog" }));
vi.mock("@/server/catalog-admin", () => ({
  catalogAdminDependencies: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
  moveProduct: vi.fn(),
  saveProduct: vi.fn(),
  deleteProduct: vi.fn(),
  saveProductImage: vi.fn(),
  deleteProductImage: vi.fn()
}));

const depsMock = vi.mocked(catalogAdminDependencies);
const fakeDeps = { repository: {}, access: {}, storeSlug: "bunker-burger" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  depsMock.mockResolvedValue({ ok: true, value: fakeDeps });
});

describe("catalog admin actions", () => {
  it("expires the public catalog cache only after a successful write", async () => {
    vi.mocked(createCategory).mockResolvedValue({ ok: true, message: "Categoría “Papas” creada.", value: { id: "c1" } });
    expect(await createCategoryAction(IDLE_FORM_STATE, new FormData())).toEqual({ status: "success", message: "Categoría “Papas” creada." });
    expect(updateTag).toHaveBeenCalledWith("catalog");
    expect(revalidatePath).toHaveBeenCalledWith("/bunker/admin/catalogo", "layout");
  });

  it("returns the use case's message and field errors and leaves the cache alone on failure", async () => {
    vi.mocked(createCategory).mockResolvedValue({ ok: false, message: "Revisá los datos marcados.", fieldErrors: { name: "Ingresá un nombre." } });
    expect(await createCategoryAction(IDLE_FORM_STATE, new FormData())).toEqual({
      status: "error",
      message: "Revisá los datos marcados.",
      fieldErrors: { name: "Ingresá un nombre." }
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("fails closed without configuration and never reaches the use case", async () => {
    depsMock.mockResolvedValue({ ok: false, error: { code: "misconfigured", message: "missing url" } });
    expect(await createCategoryAction(IDLE_FORM_STATE, new FormData())).toEqual({ status: "error", message: "No pudimos guardar los cambios. Intentá nuevamente." });
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("sends a new product to its edit page, and keeps an edited one on the form", async () => {
    vi.mocked(saveProduct).mockResolvedValue({ ok: true, message: "ok", value: { productId: "p1" } });
    await expect(saveProductAction(IDLE_FORM_STATE, new FormData())).rejects.toThrow("NEXT_REDIRECT:/bunker/admin/catalogo/productos/p1?creado=1");

    const edit = new FormData();
    edit.set("productId", "p1");
    expect(await saveProductAction(IDLE_FORM_STATE, edit)).toEqual({ status: "success", message: "ok" });
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("returns to the control panel after deleting from its page (the catalog lives there)", async () => {
    vi.mocked(deleteProduct).mockResolvedValue({ ok: true, message: "eliminado", value: undefined });
    const fromEdit = new FormData();
    fromEdit.set("from", "edit");
    await expect(deleteProductAction(IDLE_FORM_STATE, fromEdit)).rejects.toThrow("NEXT_REDIRECT:/bunker/admin");
  });
});
