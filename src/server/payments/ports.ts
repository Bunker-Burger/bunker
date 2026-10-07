export interface AuthoritativeOption {
  id: string;
  name: string;
  priceDeltaCents: bigint;
  available: boolean;
}

export interface AuthoritativeOptionGroup {
  id: string;
  minSelections: number;
  maxSelections: number;
  options: AuthoritativeOption[];
}

export interface AuthoritativeProduct {
  id: string;
  name: string;
  priceCents: bigint;
  available: boolean;
  optionGroups: AuthoritativeOptionGroup[];
}

export interface QuoteLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: bigint;
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
  expiresAt: Date;
}

export interface PricingRepository {
  findProduct(productId: string): Promise<AuthoritativeProduct | null>;
  getDeliveryFeeCents(): Promise<bigint>;
  getApplicableDiscountCents(lines: readonly QuoteLine[], now: Date): Promise<bigint>;
}

export interface PaymentQuotesPort {
  save(quote: PaymentQuote): Promise<void>;
  findById(id: string): Promise<PaymentQuote | null>;
}

export interface PaymentAttempt {
  id: string;
  quoteId: string;
  externalReference: string;
  expectedAmountCents: bigint;
  status: "pending" | "approved";
  createdAt: Date;
  providerPaymentId?: string;
}

export interface PaymentAttemptsPort {
  save(attempt: PaymentAttempt): Promise<void>;
  findByExternalReference(reference: string): Promise<PaymentAttempt | null>;
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
