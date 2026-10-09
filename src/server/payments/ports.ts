import type { AppliedPromotion } from "@/domain/promotions";
import type {
  ConfigurableOption,
  ConfigurableOptionGroup,
  ConfigurableProduct,
  FulfilmentMethod,
  OptionSelectionMode,
  ProductType,
  PromotionRule
} from "@/domain/types";

export type AuthoritativeOption = ConfigurableOption;

export interface AuthoritativeOptionGroup extends ConfigurableOptionGroup {
  id: string;
  name: string;
  selectionMode: OptionSelectionMode;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: AuthoritativeOption[];
  applicableTypes: readonly ProductType[];
}

export interface AuthoritativeProduct extends ConfigurableProduct {
  id: string;
  name: string;
  type: ProductType;
  priceCents: bigint;
  available: boolean;
  optionGroups: AuthoritativeOptionGroup[];
}

export interface QuoteLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: bigint;
  /** Product base price without options; combo and "lleve X" promotions discount at this price. */
  basePriceCents: bigint;
  selectedOptions: Array<{ groupId: string; optionId: string; optionName: string }>;
  notes: string;
}

export interface PaymentQuote {
  id: string;
  lines: QuoteLine[];
  subtotalCents: bigint;
  discountCents: bigint;
  deliveryCents: bigint;
  totalCents: bigint;
  /** The single promotion applied, as computed by the server; null when none applies. */
  promotion: AppliedPromotion | null;
  fulfillmentChannel: FulfilmentMethod;
  expiresAt: Date;
}

export interface PricingRepository {
  findProduct(productId: string): Promise<AuthoritativeProduct | null>;
  /**
   * Promotion rules of the store as persisted now (no cache: a pause applies to the next quote).
   * Evaluation (window, schedule, priority, amounts) happens in the quote, never here.
   */
  listPromotions(): Promise<readonly PromotionRule[]>;
}

export interface PaymentQuotesPort {
  save(quote: PaymentQuote): Promise<void>;
  findById(id: string): Promise<PaymentQuote | null>;
}

export interface PaymentAttempt {
  id: string;
  quoteId: string;
  idempotencyKey?: string | undefined;
  externalReference: string;
  expectedAmountCents: bigint;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  createdAt: Date;
  providerPaymentId?: string | undefined;
  providerPreferenceId?: string | undefined;
}

export interface PaymentAttemptsPort {
  save(attempt: PaymentAttempt): Promise<void>;
  updatePreferenceId?(reference: string, providerPreferenceId: string): Promise<void>;
  findByExternalReference(reference: string): Promise<PaymentAttempt | null>;
  findByIdempotencyKey?(key: string): Promise<PaymentAttempt | null>;
  markApproved(reference: string, providerPaymentId: string): Promise<void>;
}

export interface WebhookNotification {
  eventId: string;
  paymentId: string;
  headers: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
}

export interface WebhookSignatureVerifier {
  verify(notification: WebhookNotification): Promise<boolean>;
}

export interface WebhookEventsPort {
  begin(eventId: string): Promise<"started" | "duplicate">;
  complete(eventId: string): Promise<void>;
  fail(eventId: string): Promise<void>;
}

export interface ProviderPayment {
  id: string;
  externalReference: string;
  status: "approved" | "pending" | "rejected" | "cancelled";
  amountCents: bigint;
  currency: string;
}

export interface MercadoPagoPaymentGateway {
  getPayment(paymentId: string): Promise<ProviderPayment>;
}
