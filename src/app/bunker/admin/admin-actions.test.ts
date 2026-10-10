import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { savePromotion, setStoreStatus, storeAdminDependencies } from "@/server/store-admin";
import { IDLE_FORM_STATE } from "./form-state";
import { savePromotionAction } from "./promociones/actions";
import { setStoreStatusAction } from "./tienda/actions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));
vi.mock("@/server/catalog", () => ({ CATALOG_CACHE_TAG: "catalog" }));
vi.mock("@/server/store-admin", () => ({
  storeAdminDependencies: vi.fn(),
  setStoreStatus: vi.fn(),
  saveStoreContact: vi.fn(),
  addShift: vi.fn(),
  deleteShift: vi.fn(),
  savePaymentMethod: vi.fn(),
  savePromotion: vi.fn(),
  setPromotionActive: vi.fn(),
  movePromotion: vi.fn(),
  deletePromotion: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storeAdminDependencies).mockResolvedValue({ ok: true, value: {} as never });
});

describe("store and promotion actions", () => {
  it("expire the public catalog cache and the admin page only after a successful write", async () => {
    vi.mocked(setStoreStatus).mockResolvedValue({ ok: true, message: "Pedidos en pausa.", value: undefined });
    expect(await setStoreStatusAction(IDLE_FORM_STATE, new FormData())).toEqual({ status: "success", message: "Pedidos en pausa." });
    expect(updateTag).toHaveBeenCalledWith("catalog");
    expect(revalidatePath).toHaveBeenCalledWith("/bunker/admin/tienda", "layout");

    vi.clearAllMocks();
    vi.mocked(storeAdminDependencies).mockResolvedValue({ ok: true, value: {} as never });
    vi.mocked(setStoreStatus).mockResolvedValue({ ok: false, message: "Revisá los datos marcados.", fieldErrors: { statusOverride: "Configurá la tarifa de delivery antes de habilitar pedidos." } });
    expect(await setStoreStatusAction(IDLE_FORM_STATE, new FormData())).toEqual({
      status: "error",
      message: "Revisá los datos marcados.",
      fieldErrors: { statusOverride: "Configurá la tarifa de delivery antes de habilitar pedidos." }
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("fail closed without configuration and never reach the use case", async () => {
    vi.mocked(storeAdminDependencies).mockResolvedValue({ ok: false, error: { code: "misconfigured", message: "missing url" } });
    expect(await setStoreStatusAction(IDLE_FORM_STATE, new FormData())).toEqual({ status: "error", message: "No pudimos guardar los cambios. Intentá nuevamente." });
    expect(setStoreStatus).not.toHaveBeenCalled();
  });

  it("send a new promotion to its edit page and keep an edited one on the form", async () => {
    vi.mocked(savePromotion).mockResolvedValue({ ok: true, message: "ok", value: { promotionId: "pr1" } });
    await expect(savePromotionAction(IDLE_FORM_STATE, new FormData())).rejects.toThrow("NEXT_REDIRECT:/bunker/admin/promociones/pr1?creada=1");
    const edit = new FormData();
    edit.set("promotionId", "pr1");
    expect(await savePromotionAction(IDLE_FORM_STATE, edit)).toEqual({ status: "success", message: "ok" });
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});
