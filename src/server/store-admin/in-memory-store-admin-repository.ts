import type { PromotionWindow } from "@/domain/types";
import { err, ok } from "@/lib/result";
import type { AdminResult } from "@/server/admin/use-case";
import { catalogError } from "@/server/catalog/errors";
import type { PromotionFields, PromotionItem, StoreAdminRepository, StoredPaymentMethod, StoredShift, StoredStore } from "./ports";

/* Test double: one store's operation settings and promotions, with the DB rules the use cases rely on. */

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

  async listPaymentMethods(storeId: string) {
    return this.fail("listPaymentMethods") ?? ok(
        this.paymentMethods
          .filter((method) => method.storeId === storeId)
          .map((method) => ({ method: method.method, displayName: method.displayName, instructions: method.instructions, enabled: method.enabled, sortOrder: method.sortOrder }))
      );
  }

  async savePaymentMethod(storeId: string, method: StoredPaymentMethod): Promise<AdminResult<void>> {
    const failed = this.fail("savePaymentMethod");
    if (failed) return failed;
    this.paymentMethods = [...this.paymentMethods.filter((m) => !(m.storeId === storeId && m.method === method.method)), { storeId, ...method }];
    this.writes.push(`savePaymentMethod:${method.method}:${method.enabled}`);
    return ok(undefined);
  }

  async listPromotions(storeId: string) {
    return (
      this.fail("listPromotions") ??
      ok(this.promotions.filter((promotion) => promotion.storeId === storeId).map((p) => ({ id: p.id, priority: p.priority, active: p.active, name: p.name })))
    );
  }

  async listProductIds(storeId: string) {
    return this.fail("listProductIds") ?? ok(this.productIds.filter((product) => product.storeId === storeId).map((product) => product.id));
  }

  private find(storeId: string, promotionId: string) {
    return this.promotions.find((promotion) => promotion.storeId === storeId && promotion.id === promotionId);
  }

  async createPromotion(storeId: string, fields: PromotionFields & { priority: number }) {
    const failed = this.fail("createPromotion");
    if (failed) return failed;
    if (this.promotions.some((p) => p.storeId === storeId && (p.slug === fields.slug || p.priority === fields.priority))) return err({ code: "conflict" as const, message: "23505" });
    const id = this.id();
    this.promotions.push({ id, storeId, ...fields, items: [], schedule: [] });
    this.writes.push(`createPromotion:active=${fields.active}:priority=${fields.priority}`);
    return ok({ id });
  }

  async updatePromotion(storeId: string, promotionId: string, fields: PromotionFields): Promise<AdminResult<void>> {
    const failed = this.fail("updatePromotion");
    if (failed) return failed;
    const promotion = this.find(storeId, promotionId);
    if (!promotion) return catalogError("not_found", "no row");
    if (this.promotions.some((p) => p.storeId === storeId && p.id !== promotionId && p.slug === fields.slug)) return err({ code: "conflict", message: "23505" });
    Object.assign(promotion, fields);
    this.writes.push(`updatePromotion:active=${fields.active}`);
    return ok(undefined);
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

  async setPromotionPriority(storeId: string, promotionId: string, priority: number): Promise<AdminResult<void>> {
    const failed = this.fail("setPromotionPriority");
    if (failed) return failed;
    const promotion = this.find(storeId, promotionId);
    if (!promotion) return catalogError("not_found", "no row");
    // unique (store_id, priority)
    if (this.promotions.some((p) => p.storeId === storeId && p.id !== promotionId && p.priority === priority)) return err({ code: "conflict", message: "23505" });
    promotion.priority = priority;
    this.writes.push(`setPromotionPriority:${promotion.name}=${priority}`);
    return ok(undefined);
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

  async replacePromotionItems(storeId: string, promotionId: string, items: PromotionItem[]): Promise<AdminResult<void>> {
    const failed = this.fail("replacePromotionItems");
    if (failed) return failed;
    const promotion = this.find(storeId, promotionId);
    if (!promotion) return catalogError("not_found", "no row");
    promotion.items = items.map((item) => ({ ...item }));
    this.writes.push(`replacePromotionItems:${items.length}:active=${promotion.active}`);
    return ok(undefined);
  }

  async replacePromotionSchedule(storeId: string, promotionId: string, windows: PromotionWindow[]): Promise<AdminResult<void>> {
    const failed = this.fail("replacePromotionSchedule");
    if (failed) return failed;
    const promotion = this.find(storeId, promotionId);
    if (!promotion) return catalogError("not_found", "no row");
    promotion.schedule = windows.map((window) => ({ ...window }));
    this.writes.push(`replacePromotionSchedule:${windows.length}:active=${promotion.active}`);
    return ok(undefined);
  }
}
