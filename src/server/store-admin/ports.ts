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

/** What the admin decides about a method. Its name and customer copy are fixed (no free text). */
export interface StoredPaymentMethod {
  method: PaymentMethodKind;
  enabled: boolean;
  sortOrder: number;
}

export interface StoreContactFields {
  deliveryFeeCents: bigint | null;
  whatsappE164: string;
  /** Where pickup orders are collected and its map link; null clears them (issue #54). */
  pickupAddress: string | null;
  pickupMapsUrl: string | null;
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

/** A promotion as the admin form sends it: row fields, products and weekly windows. */
export interface PromotionDraft {
  fields: PromotionFields;
  items: PromotionItem[];
  schedule: PromotionWindow[];
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

  savePaymentMethod(storeId: string, method: StoredPaymentMethod): Promise<AdminResult<void>>;

  listProductIds(storeId: string): Promise<AdminResult<string[]>>;
  /**
   * Creates (`promotionId` null, next priority) or updates a promotion with its products and
   * windows in one transaction: everything is stored or nothing is.
   */
  savePromotion(storeId: string, promotionId: string | null, draft: PromotionDraft): Promise<AdminResult<{ id: string }>>;
  setPromotionActive(storeId: string, promotionId: string, active: boolean): Promise<AdminResult<void>>;
  /** Swaps priorities with the neighbour in one transaction; `moved: false` at the end of the list. */
  movePromotion(storeId: string, promotionId: string, direction: "up" | "down"): Promise<AdminResult<{ moved: boolean }>>;
  /** Ids of the store's promotions, highest priority (tried first) first. */
  listPromotionOrder(storeId: string): Promise<AdminResult<string[]>>;
  deletePromotion(storeId: string, promotionId: string): Promise<AdminResult<void>>;
}
