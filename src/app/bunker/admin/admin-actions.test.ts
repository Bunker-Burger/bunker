import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/result";
import { createInMemoryAdminAccess } from "@/server/catalog/in-memory-admin-access";
import { savePromotion, setStoreStatus, storeAdminDependencies } from "@/server/store-admin";
import { InMemoryStoreAdminRepository } from "@/server/store-admin/in-memory-store-admin-repository";
import * as service from "@/server/store-admin/store-admin-service";
import { performAdminAction } from "./admin-action";
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
    expect(revalidatePath).toHaveBeenCalledWith("/bunker/admin", "layout");

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

describe("cache expiry after a failed write", () => {
  const STORE = "0199b2c8-40b0-7000-8000-000000000001";
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const PROMO = "0d000000-0000-4000-8000-000000000001";
  const SMASH = "0199b2c8-40b0-7000-8000-000000000201";

  function setup(session: { userId: string } | null = { userId: OWNER }) {
    const repository = new InMemoryStoreAdminRepository();
    repository.stores = [{ id: STORE, timezone: "America/Argentina/Tucuman", statusOverride: "closed", deliveryFeeCents: null, whatsappE164: "+5491100000000" }];
    repository.productIds = [{ id: SMASH, storeId: STORE }];
    repository.promotions = [
      {
        id: PROMO,
        storeId: STORE,
        priority: 1,
        name: "Vieja",
        slug: "vieja",
        description: "",
        badgeText: null,
        mechanic: { type: "percent_off", percentOff: 10 },
        channels: ["delivery"],
        startsAt: new Date("2026-10-01T03:00:00Z"),
        endsAt: new Date("2026-12-01T03:00:00Z"),
        active: true,
        items: [],
        schedule: []
      }
    ];
    const deps = {
      repository,
      access: createInMemoryAdminAccess(session, [{ userId: OWNER, storeId: STORE, storeSlug: "bunker-burger", role: "owner", active: true }]),
      storeSlug: "bunker-burger",
      mercadoPagoConfigured: () => false,
      log: { error: vi.fn() }
    };
    return { repository, run: (operation: typeof service.savePromotion, form: FormData) => performAdminAction(async () => ok(deps), operation, form, "/bunker/admin/promociones") };
  }

  const promotionForm = () => {
    const form = new FormData();
    const fields = {
      promotionId: PROMO,
      name: "Vieja",
      type: "percent_off",
      percentOff: "20",
      channel: "delivery",
      startsAt: "2026-10-01T00:00",
      endsAt: "2026-11-30T00:00",
      active: "on"
    };
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };

  it("expires the menu even when the promotion write fails, so it never keeps announcing a rule the quote does not apply", async () => {
    const { repository, run } = setup();
    repository.failing.set("savePromotion", { code: "unavailable", message: "connection reset after commit?" });
    const { state } = await run(service.savePromotion, promotionForm());
    expect(state).toEqual({ status: "error", message: "No pudimos guardar los cambios. Intentá nuevamente." });
    expect(updateTag).toHaveBeenCalledWith("catalog");
    expect(revalidatePath).toHaveBeenCalledWith("/bunker/admin/promociones", "layout");
  });

  it("expires it when a reorder fails", async () => {
    const { repository, run } = setup();
    repository.failing.set("movePromotion", { code: "unavailable", message: "timeout" });
    const form = new FormData();
    form.set("promotionId", PROMO);
    form.set("direction", "up");
    expect((await run(service.movePromotion as typeof service.savePromotion, form)).state.status).toBe("error");
    expect(updateTag).toHaveBeenCalledWith("catalog");
  });

  it("does not expire anything when validation or permissions stop the use case before writing", async () => {
    const invalid = promotionForm();
    invalid.set("percentOff", "120");
    const { repository, run } = setup();
    expect((await run(service.savePromotion, invalid)).state).toMatchObject({ status: "error", fieldErrors: { percentOff: expect.any(String) } });
    expect(repository.writes).toEqual([]);

    const outsider = setup({ userId: "22222222-2222-4222-8222-222222222222" });
    expect((await outsider.run(service.savePromotion, promotionForm())).state).toMatchObject({ status: "error" });
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
