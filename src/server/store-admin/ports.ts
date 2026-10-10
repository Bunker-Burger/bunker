import type { StoreStatusOverride } from "@/domain/store-status";
import type { FulfilmentMethod, PaymentMethodKind, PromotionMechanic, PromotionWindow } from "@/domain/types";
import type { AdminResult } from "@/server/admin/use-case";

export const STATUS_OVERRIDES = ["auto", "open", "paused", "closed"] as const satisfies readonly StoreStatusOverride[];
export const PAYMENT_METHODS = ["cash", "bank_transfer", "mercado_pago"] as const satisfies readonly PaymentMethodKind[];

export interface StoredStore {
  id: string;
  timezone: string;
  statusOverride: StoreStatusOverride;
  deliveryFeeCents: bigint | null;
  whatsappE164: string;
}

export interface StoredShift {
  id: string;
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface StoredPaymentMethod {
  method: PaymentMethodKind;
  displayName: string;
  instructions: string;
  enabled: boolean;
  sortOrder: number;
}

export interface StoreContactFields {
  deliveryFeeCents: bigint | null;
  whatsappE164: string;
}

export interface PromotionFields {
  name: string;
  slug: string;
  description: string;
  badgeText: string | null;
  mechanic: PromotionMechanic;
  channels: FulfilmentMethod[];
  startsAt: Date;
  endsAt: Date;
  active: boolean;
}

export interface PromotionItem {
  productId: string;
  quantity: number;
}

export interface StoredPromotion {
  id: string;
  priority: number;
  active: boolean;
  name: string;
}

/**
 * Store and promotion writes as the signed-in admin. Scoped by `storeId`; RLS still decides,
 * and a write RLS filters out comes back as `not_found`.
 */
export interface StoreAdminRepository {
  getStore(storeId: string): Promise<AdminResult<StoredStore | null>>;
  setStatusOverride(storeId: string, statusOverride: StoreStatusOverride): Promise<AdminResult<void>>;
  setContact(storeId: string, fields: StoreContactFields): Promise<AdminResult<void>>;

  listShifts(storeId: string): Promise<AdminResult<StoredShift[]>>;
  addShift(storeId: string, shift: Omit<StoredShift, "id">): Promise<AdminResult<void>>;
  deleteShift(storeId: string, shiftId: string): Promise<AdminResult<void>>;

  listPaymentMethods(storeId: string): Promise<AdminResult<StoredPaymentMethod[]>>;
  savePaymentMethod(storeId: string, method: StoredPaymentMethod): Promise<AdminResult<void>>;

  listPromotions(storeId: string): Promise<AdminResult<StoredPromotion[]>>;
  listProductIds(storeId: string): Promise<AdminResult<string[]>>;
  createPromotion(storeId: string, fields: PromotionFields & { priority: number }): Promise<AdminResult<{ id: string }>>;
  updatePromotion(storeId: string, promotionId: string, fields: PromotionFields): Promise<AdminResult<void>>;
  setPromotionActive(storeId: string, promotionId: string, active: boolean): Promise<AdminResult<void>>;
  setPromotionPriority(storeId: string, promotionId: string, priority: number): Promise<AdminResult<void>>;
  deletePromotion(storeId: string, promotionId: string): Promise<AdminResult<void>>;
  /** Verified like product option links: every old row removed, every new one stored, read back equal. */
  replacePromotionItems(storeId: string, promotionId: string, items: PromotionItem[]): Promise<AdminResult<void>>;
  replacePromotionSchedule(storeId: string, promotionId: string, windows: PromotionWindow[]): Promise<AdminResult<void>>;
}
