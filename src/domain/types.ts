import type { BusinessHoursWindow, StoreStatusOverride } from "./store-status";

export type ProductType = "burger" | "sandwich" | "fries" | "beverage" | "other";

export interface ConfigurableOption {
  id: string;
  name: string;
  priceDeltaCents: bigint;
  available: boolean;
}

/** Persisted selection semantics; never inferred from min/max cardinality. */
export type OptionSelectionMode = "single" | "multiple";

export interface ConfigurableOptionGroup {
  id: string;
  name: string;
  selectionMode: OptionSelectionMode;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: readonly ConfigurableOption[];
  applicableTypes?: readonly ProductType[];
}

export interface ConfigurableProduct {
  id: string;
  name: string;
  type: ProductType;
  priceCents: bigint;
  optionGroups: readonly ConfigurableOptionGroup[];
}

export type ProductOption = ConfigurableOption;

export interface OptionGroup extends ConfigurableOptionGroup {
  required: boolean;
  defaultOptionIds: string[];
  options: ProductOption[];
  applicableTypes: readonly ProductType[];
}

export type OptionSelectionErrorCode =
  | "UNKNOWN_GROUP"
  | "UNKNOWN_OPTION"
  | "OPTION_UNAVAILABLE"
  | "REQUIRED_GROUP_EMPTY"
  | "BELOW_MIN_SELECTIONS"
  | "EXCEEDS_MAX_SELECTIONS"
  | "SINGLE_SELECT_MULTIPLE_CHOICES"
  | "INAPPLICABLE_GROUP"
  | "DUPLICATE_SELECTION";

export interface OptionSelectionError {
  groupId: string;
  optionId?: string | undefined;
  code: OptionSelectionErrorCode;
  message: string;
}

export type PublicationErrorCode =
  | "MISSING_NAME"
  | "MISSING_SLUG"
  | "MISSING_DESCRIPTION"
  | "NEGATIVE_PRICE"
  | "ZERO_OR_NEGATIVE_PRICE"
  | "ALCOHOL_BEVERAGE"
  | "INVALID_CARDINALITY"
  | "MISSING_DEFAULT_OPTION"
  | "UNAVAILABLE_DEFAULT_OPTION"
  | "DEFAULT_BELOW_MIN"
  | "DEFAULT_EXCEEDS_MAX"
  | "DEFAULT_DUPLICATES"
  | "DEFAULT_SINGLE_SELECT_MULTIPLE"
  | "INAPPLICABLE_OPTION_GROUP"
  | "INSUFFICIENT_AVAILABLE_OPTIONS";

export interface PublicationError {
  code: PublicationErrorCode;
  message: string;
  groupId?: string | undefined;
  optionId?: string | undefined;
}

export interface ValidatedOptionSelection {
  unitPriceCents: bigint;
  normalizedSelections: SelectedOptions;
  selectedDetails: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: bigint;
  }>;
}

export interface Product extends ConfigurableProduct {
  slug: string;
  categoryId: string;
  description: string;
  compareAtPriceCents?: bigint;
  /** Null when the product has no photo yet. */
  imageUrl: string | null;
  imageAlt?: string;
  /** Percentages (0–100) of the photo kept in view when it is cropped; centred when absent. */
  imageFocalPoint?: { x: number; y: number };
  /** Manual order inside the category (lower first); ties fall back to featured, then name. */
  sortOrder?: number;
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

export type CartIssueCode =
  | "product_removed"
  | "out_of_stock"
  | "price_changed"
  | "option_unavailable"
  | "option_invalid"
  | "option_group_removed";

export interface CartIssue {
  readonly code: CartIssueCode;
  readonly lineId: string;
  readonly productId: string;
  readonly productName: string;
  readonly message: string;
  readonly blocking: boolean;
  readonly oldPriceCents?: bigint;
  readonly newPriceCents?: bigint;
  readonly groupId?: string;
  readonly optionId?: string;
  readonly optionName?: string;
}

export interface RevalidationResult {
  readonly validLines: CartLine[];
  readonly issues: CartIssue[];
  readonly hasChanges: boolean;
  readonly hasBlockingIssues: boolean;
}

export type FulfilmentMethod = "pickup" | "delivery";

export interface Category {
  id: string;
  slug: string;
  name: string;
  type: ProductType;
  sortOrder: number;
  visible: boolean;
}

export type PaymentMethodKind = "cash" | "bank_transfer" | "mercado_pago";

/** No free text: names and customer copy are fixed per method (see public-payment-options). */
export interface PaymentMethodSetting {
  method: PaymentMethodKind;
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
  /** Where pickup orders are collected and its map link (issue #54); absent until set. */
  pickupAddress?: string | null;
  pickupMapsUrl?: string | null;
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
  /** Photo for the menu's promotion banner (issue #54); absent when there is none. */
  imageUrl?: string | null;
  /** Percentages (0–100) of the photo kept in view when the banner crops it; centred when absent. */
  imageFocalPoint?: { x: number; y: number };
  priority: number;
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  mechanic: PromotionMechanic;
  channels: FulfilmentMethod[];
  items: Array<{ productId: string; quantity: number }>;
  schedule: PromotionWindow[];
}

/** What the storefront renders: products and the categories they belong to, from one read. */
export interface PublicCatalogSnapshot {
  products: Product[];
  categories: Category[];
}

export interface Catalog {
  store: StoreSettings;
  categories: Category[];
  products: Product[];
  promotions: PromotionRule[];
}
