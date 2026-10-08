import type { BusinessHoursWindow, StoreStatusOverride } from "./store-status";

export type ProductType = "burger" | "sandwich" | "fries" | "beverage" | "other";

export interface ProductOption {
  id: string;
  name: string;
  priceDeltaCents: bigint;
  available: boolean;
}

/** Persisted selection semantics; never inferred from min/max cardinality. */
export type OptionSelectionMode = "single" | "multiple";

export interface OptionGroup {
  id: string;
  name: string;
  selectionMode: OptionSelectionMode;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  defaultOptionIds: string[];
  options: ProductOption[];
}

export interface Product {
  id: string;
  slug: string;
  categoryId: string;
  type: ProductType;
  name: string;
  description: string;
  priceCents: bigint;
  compareAtPriceCents?: bigint;
  /** Null when the product has no photo yet. */
  imageUrl: string | null;
  imageAlt?: string;
  published: boolean;
  featured: boolean;
  inStock: boolean;
  containsAlcohol?: boolean;
  optionGroups: OptionGroup[];
}

export type SelectedOptions = Record<string, string[]>;

export interface CartLine {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  unitPriceCents: bigint;
  quantity: number;
  notes: string;
  selectedOptions: SelectedOptions;
}

export type FulfilmentMethod = "pickup" | "delivery";

export interface Promotion {
  id: string;
  name: string;
  priority: number;
  kind: "percentage" | "fixed";
  value: number;
  active: boolean;
  productIds?: string[];
  startsAt?: string;
  endsAt?: string;
}

export interface Quote {
  subtotalCents: bigint;
  discountCents: bigint;
  deliveryCents: bigint;
  totalCents: bigint;
  promotion: Promotion | null;
}


export interface Category {
  id: string;
  slug: string;
  name: string;
  type: ProductType;
  sortOrder: number;
  visible: boolean;
}

export type PaymentMethodKind = "cash" | "bank_transfer" | "mercado_pago";

export interface PaymentMethodSetting {
  method: PaymentMethodKind;
  displayName: string;
  instructions: string;
  enabled: boolean;
  sortOrder: number;
}

export interface StoreSettings {
  id: string;
  slug: string;
  name: string;
  whatsappE164: string;
  timezone: string;
  currency: string;
  statusOverride: StoreStatusOverride;
  isPublic: boolean;
  /** Fixed delivery fee; null until configured, which keeps orders disabled. */
  deliveryFeeCents: bigint | null;
  businessHours: readonly BusinessHoursWindow[];
  paymentMethods: PaymentMethodSetting[];
}

export type PromotionMechanic =
  | { type: "fixed_price"; fixedPriceCents: bigint }
  | { type: "percent_off"; percentOff: number }
  | { type: "buy_x_get_y"; buyQuantity: number; getQuantity: number }
  | { type: "free_delivery" };

export interface PromotionWindow {
  /** 0 = Sunday … 6 = Saturday, in the store timezone. */
  dayOfWeek: number;
  /** Local wall-clock time, "HH:MM:SS". */
  startsAt: string;
  endsAt: string;
}

/** Promotion as configured in the database; evaluation lives in the pricing engine. */
export interface PromotionRule {
  id: string;
  slug: string;
  name: string;
  description: string;
  badgeText: string | null;
  priority: number;
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  mechanic: PromotionMechanic;
  channels: FulfilmentMethod[];
  items: Array<{ productId: string; quantity: number }>;
  schedule: PromotionWindow[];
}

export interface Catalog {
  store: StoreSettings;
  categories: Category[];
  products: Product[];
  promotions: PromotionRule[];
}
