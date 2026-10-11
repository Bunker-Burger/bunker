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
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "refunded";
  createdAt: Date;
  providerPaymentId?: string | undefined;
  providerPreferenceId?: string | undefined;
  /** Raw status last reported by Mercado Pago (`in_process`, `approved`…). */
  providerStatus?: string | undefined;
  /** Minimal contact of who pays, kept with the attempt for the 90-day retention (BB-15). */
  customer?: { name: string; phone: string } | undefined;
}

/**
 * What applying a provider payment did to its attempt (BB-15). Only `approved` credits the
 * attempt; the mismatches and `conflicting_payment` credit nothing and need a person to look.
 */
export type ProviderPaymentOutcome =
  | "approved"
  | "refunded"
  | "rejected"
  | "cancelled"
  | "pending"
  | "unchanged"
  | "unknown_reference"
  | "currency_mismatch"
  | "amount_mismatch"
  | "conflicting_payment";

export interface PaymentAttemptsPort {
  /** Records a new attempt; never overwrites an existing one with the same reference (BB-15 R1 H3). */
  save(attempt: PaymentAttempt): Promise<void>;
  /**
   * Records the preference id on an attempt that is still open (`created`/`pending`), without
   * touching its status or payment. `false` when the attempt was settled meanwhile (approved,
   * refunded…) or does not exist: nothing was written.
   */
  updatePreferenceId?(reference: string, providerPreferenceId: string): Promise<boolean | void>;
  findByExternalReference(reference: string): Promise<PaymentAttempt | null>;
  findByIdempotencyKey?(key: string): Promise<PaymentAttempt | null>;
  markApproved(reference: string, providerPaymentId: string): Promise<void>;
  /**
   * Applies a payment read from the Mercado Pago API to the attempt of its reference, atomically:
   * amount and currency are checked against the attempt and its frozen quote, an approved attempt
   * never goes back, and a second approved payment is reported instead of recorded.
   */
  applyProviderPayment?(payment: ProviderPayment): Promise<ProviderPaymentOutcome>;
}

/** What the webhook route extracted from Mercado Pago's request (BB-15). */
export interface WebhookNotification {
  /** Notification id (`id` of the body): the deduplication key. */
  eventId: string;
  /** Notification type (`payment`, `merchant_order`…). */
  type: string;
  /** `data.id` from the query string: the signed resource id (the payment id for `payment`). */
  dataId: string;
  /** `x-signature` header (`ts=…,v1=…`). */
  signature: string | null;
  /** `x-request-id` header, part of the signed manifest. */
  requestId: string | null;
}

export interface WebhookSignatureVerifier {
  verify(notification: WebhookNotification): Promise<boolean>;
}

/** This delivery's lease on a webhook event; renewed by every claim or takeover. */
export interface WebhookClaim {
  eventId: string;
  token: string;
}

export interface WebhookEventsPort {
  /**
   * The claim when this delivery owns the event, `null` for a duplicate. A failed claim, or one
   * abandoned for more than 60 s, can be taken by the next delivery, which gets a new token.
   */
  begin(eventId: string, providerPaymentId: string): Promise<WebhookClaim | null>;
  /** Closes the event only while `claim` is still its current lease; false when it was taken over. */
  complete(claim: WebhookClaim): Promise<boolean>;
  /** Records why the event was not applied (`amount_mismatch`, `provider_unavailable`…), same fencing. */
  fail(claim: WebhookClaim, errorCode: string): Promise<boolean>;
}

export interface ProviderPayment {
  id: string;
  /** Null when the payment does not carry one (not created by this store's checkout). */
  externalReference: string | null;
  /** Raw Mercado Pago status: approved, pending, in_process, authorized, in_mediation, rejected, cancelled, refunded, charged_back. */
  status: string;
  amountCents: bigint;
  currency: string;
}

export interface MercadoPagoPaymentGateway {
  /** Throws `PaymentNotFoundError` when Mercado Pago does not know the payment, any other error when it could not answer. */
  getPayment(paymentId: string): Promise<ProviderPayment>;
}
