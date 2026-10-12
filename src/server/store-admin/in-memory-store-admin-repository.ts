import type { PromotionWindow } from "@/domain/types";
import { err, ok } from "@/lib/result";
import type { AdminResult } from "@/server/admin/use-case";
import { catalogError } from "@/server/catalog/errors";
import type { PromotionDraft, PromotionFields, PromotionItem, StoreAdminRepository, StoredPaymentMethod, StoredShift, StoredStore } from "./ports";

/*
 * Test double: one store's operation settings and promotions, with the DB rules the use cases rely
 * on. Saving and moving a promotion are all-or-nothing, like the SQL functions behind them.
 */

export interface MemoryPromotion extends PromotionFields {
  id: string;
  storeId: string;
  priority: number;
  items: PromotionItem[];
  schedule: PromotionWindow[];
}

export class InMemoryStoreAdminRepository implements StoreAdminRepository {
  stores: StoredStore[] = [];
  shifts: Array<StoredShift & { storeId: string }> = [];
  paymentMethods: Array<StoredPaymentMethod & { storeId: string }> = [];
  promotions: MemoryPromotion[] = [];
  productIds: Array<{ id: string; storeId: string }> = [];
  writes: string[] = [];
  failing = new Map<string, { code: "unavailable" | "conflict" | "rejected"; message: string }>();
  private next = 1;

  private fail(method: string) {
    const failure = this.failing.get(method);
    if (!failure) return null;
    return failure.code === "unavailable" ? catalogError("unavailable", failure.message) : err(failure);
  }

  private id() {
    return `0b000000-0000-4000-8000-${String(this.next++).padStart(12, "0")}`;
  }

  async getStore(storeId: string) {
    return this.fail("getStore") ?? ok(this.stores.find((store) => store.id === storeId) ?? null);
  }

  async setStatusOverride(storeId: string, statusOverride: StoredStore["statusOverride"]): Promise<AdminResult<void>> {
    const failed = this.fail("setStatusOverride");
    if (failed) return failed;
    const store = this.stores.find((candidate) => candidate.id === storeId);
    if (!store) return catalogError("not_found", "no row");
    // stores_delivery_fee_required_to_accept_orders
    if (store.deliveryFeeCents === null && (statusOverride === "auto" || statusOverride === "open")) return err({ code: "rejected", message: "23514" });
    store.statusOverride = statusOverride;
    this.writes.push(`setStatusOverride:${statusOverride}`);
    return ok(undefined);
  }

  async setContact(storeId: string, fields: { deliveryFeeCents: bigint | null; whatsappE164: string }): Promise<AdminResult<void>> {
    const failed = this.fail("setContact");
    if (failed) return failed;
    const store = this.stores.find((candidate) => candidate.id === storeId);
    if (!store) return catalogError("not_found", "no row");
    if (fields.deliveryFeeCents === null && (store.statusOverride === "auto" || store.statusOverride === "open")) return err({ code: "rejected", message: "23514" });
    Object.assign(store, fields);
    this.writes.push(`setContact:${fields.deliveryFeeCents}:${fields.whatsappE164}`);
    return ok(undefined);
  }

  async listShifts(storeId: string) {
    return this.fail("listShifts") ?? ok(this.shifts.filter((shift) => shift.storeId === storeId).map((shift) => ({ id: shift.id, dayOfWeek: shift.dayOfWeek, opensAt: shift.opensAt, closesAt: shift.closesAt })));
  }

  async addShift(storeId: string, shift: Omit<StoredShift, "id">): Promise<AdminResult<void>> {
    const failed = this.fail("addShift");
    if (failed) return failed;
    if (this.shifts.some((s) => s.storeId === storeId && s.dayOfWeek === shift.dayOfWeek && s.opensAt === shift.opensAt)) return err({ code: "conflict", message: "23505" });
    this.shifts.push({ id: this.id(), storeId, ...shift });
    this.writes.push(`addShift:${shift.dayOfWeek}@${shift.opensAt}-${shift.closesAt}`);
    return ok(undefined);
  }

  async deleteShift(storeId: string, shiftId: string): Promise<AdminResult<void>> {
    const failed = this.fail("deleteShift");
    if (failed) return failed;
    const before = this.shifts.length;
    this.shifts = this.shifts.filter((shift) => !(shift.storeId === storeId && shift.id === shiftId));
    if (before === this.shifts.length) return catalogError("not_found", "no row");
    this.writes.push(`deleteShift:${shiftId}`);
    return ok(undefined);
  }

  async savePaymentMethod(storeId: string, method: StoredPaymentMethod): Promise<AdminResult<void>> {
    const failed = this.fail("savePaymentMethod");
    if (failed) return failed;
    this.paymentMethods = [...this.paymentMethods.filter((m) => !(m.storeId === storeId && m.method === method.method)), { storeId, ...method }];
    this.writes.push(`savePaymentMethod:${method.method}:${method.enabled}`);
    return ok(undefined);
  }

  async listProductIds(storeId: string) {
    return this.fail("listProductIds") ?? ok(this.productIds.filter((product) => product.storeId === storeId).map((product) => product.id));
  }

  private find(storeId: string, promotionId: string) {
    return this.promotions.find((promotion) => promotion.storeId === storeId && promotion.id === promotionId);
  }

  async savePromotion(storeId: string, promotionId: string | null, { fields, items, schedule }: PromotionDraft) {
    const failed = this.fail("savePromotion");
    if (failed) return failed;
    const existing = promotionId === null ? null : this.find(storeId, promotionId);
    if (promotionId !== null && !existing) return catalogError("not_found", "P0002");
    if (this.promotions.some((p) => p.storeId === storeId && p.id !== promotionId && p.slug === fields.slug)) return err({ code: "conflict" as const, message: "23505" });
    // promotion_items_product_fk (product_id, store_id)
    if (items.some((item) => !this.productIds.some((product) => product.storeId === storeId && product.id === item.productId))) return err({ code: "conflict" as const, message: "23503" });
    const stored = { ...fields, items: items.map((item) => ({ ...item })), schedule: schedule.map((window) => ({ ...window })) };
    if (existing) {
      Object.assign(existing, stored);
      this.writes.push(`savePromotion:update:active=${fields.active}`);
      return ok({ id: existing.id });
    }
    const priority = this.promotions.filter((p) => p.storeId === storeId).reduce((max, p) => Math.max(max, p.priority), 0) + 1;
    if (priority > 32_767) return err({ code: "rejected" as const, message: "BB013" });
    const id = this.id();
    this.promotions.push({ id, storeId, priority, ...stored });
    this.writes.push(`savePromotion:create:active=${fields.active}:priority=${priority}`);
    return ok({ id });
  }

  async setPromotionActive(storeId: string, promotionId: string, active: boolean): Promise<AdminResult<void>> {
    const failed = this.fail("setPromotionActive");
    if (failed) return failed;
    const promotion = this.find(storeId, promotionId);
    if (!promotion) return catalogError("not_found", "no row");
    promotion.active = active;
    this.writes.push(`setPromotionActive:${active}`);
    return ok(undefined);
  }

  async movePromotion(storeId: string, promotionId: string, direction: "up" | "down") {
    const failed = this.fail("movePromotion");
    if (failed) return failed;
    const promotion = this.find(storeId, promotionId);
    if (!promotion) return catalogError("not_found", "P0002");
    const others = this.promotions.filter((p) => p.storeId === storeId && (direction === "up" ? p.priority > promotion.priority : p.priority < promotion.priority));
    const neighbour = others.sort((a, b) => (direction === "up" ? a.priority - b.priority : b.priority - a.priority))[0];
    if (!neighbour) return ok({ moved: false });
    [promotion.priority, neighbour.priority] = [neighbour.priority, promotion.priority];
    this.writes.push(`movePromotion:${promotion.name}=${promotion.priority},${neighbour.name}=${neighbour.priority}`);
    return ok({ moved: true });
  }

  async listPromotionOrder(storeId: string) {
    const ordered = this.promotions
      .filter((promotion) => promotion.storeId === storeId)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map((promotion) => promotion.id);
    return this.fail("listPromotionOrder") ?? ok(ordered);
  }

  async deletePromotion(storeId: string, promotionId: string): Promise<AdminResult<void>> {
    const failed = this.fail("deletePromotion");
    if (failed) return failed;
    const before = this.promotions.length;
    this.promotions = this.promotions.filter((promotion) => !(promotion.storeId === storeId && promotion.id === promotionId));
    if (before === this.promotions.length) return catalogError("not_found", "no row");
    this.writes.push(`deletePromotion:${promotionId}`);
    return ok(undefined);
  }
}
