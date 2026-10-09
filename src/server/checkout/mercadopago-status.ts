import type { Catalog } from "@/domain/types";
import type { Result } from "@/lib/result";
import type { CatalogError } from "@/server/catalog/errors";
import {
  detectMercadoPagoConfig,
  type MercadoPagoConfigDetection
} from "@/server/payments/mercado-pago";
import type {
  PaymentAttemptsPort,
  PaymentQuote,
  PaymentQuotesPort
} from "@/server/payments/ports";
import { buildApprovedMercadoPagoWhatsAppUrl } from "./whatsapp";

export type PaymentVerificationStatus =
  | {
      status: "approved";
      externalReference: string;
      paymentReference: string;
      totalCents: string;
      whatsappUrl: string | null;
    }
  | {
      status: "pending";
      verifying: boolean;
    }
  | {
      status: "rejected";
      message: string;
    }
  | {
      status: "expired";
    }
  | {
      status: "not_found";
    }
  | {
      status: "invalid_reference";
    };

export interface CheckPaymentStatusDependencies {
  attempts: PaymentAttemptsPort;
  quotes: PaymentQuotesPort;
  loadCatalog?(): Promise<Result<Catalog, CatalogError>>;
  detectConfig?(): MercadoPagoConfigDetection;
  fetcher?: typeof fetch;
  now?: () => Date;
}

async function getWhatsAppUrlForApprovedQuote(
  quote: PaymentQuote,
  paymentReference: string,
  loadCatalog?: () => Promise<Result<Catalog, CatalogError>>
): Promise<string | null> {
  if (!loadCatalog) return null;
  const catalogResult = await loadCatalog();
  if (!catalogResult.ok) return null;
  try {
    return buildApprovedMercadoPagoWhatsAppUrl({
      businessPhone: catalogResult.value.store.whatsappE164,
      fulfilment: quote.fulfillmentChannel,
      pricing: quote,
      paymentReference
    });
  } catch {
    return null;
  }
}

export async function checkMercadoPagoPaymentStatus(
  params: { ref: string | null; paymentId?: string | null },
  dependencies: CheckPaymentStatusDependencies
): Promise<PaymentVerificationStatus> {
  const { ref, paymentId } = params;

  if (!ref || typeof ref !== "string" || ref.trim().length < 8 || ref.trim().length > 128) {
    return { status: "invalid_reference" };
  }

  const cleanRef = ref.trim();
  const attempt = await dependencies.attempts.findByExternalReference(cleanRef);
  if (!attempt) {
    return { status: "not_found" };
  }

  const now = dependencies.now ? dependencies.now() : new Date();

  // 1. Si ya está aprobado autoritativamente en la base de datos
  if (attempt.status === "approved") {
    const quote = await dependencies.quotes.findById(attempt.quoteId);
    const whatsappUrl = quote
      ? await getWhatsAppUrlForApprovedQuote(
          quote,
          attempt.providerPaymentId ?? attempt.externalReference,
          dependencies.loadCatalog
        )
      : null;

    return {
      status: "approved",
      externalReference: attempt.externalReference,
      paymentReference: attempt.providerPaymentId ?? attempt.externalReference,
      totalCents: attempt.expectedAmountCents.toString(),
      whatsappUrl
    };
  }

  // 2. Reconciliación server-to-server ante retorno o recuperación de retorno abandonado
  if (attempt.status === "pending") {
    const detectConfig = dependencies.detectConfig ?? detectMercadoPagoConfig;
    const configDetection = detectConfig();

    if (configDetection.enabled) {
      const fetcher = dependencies.fetcher ?? fetch;
      try {
        let mpPayment: Record<string, unknown> | null = null;

        // Caso A: El cliente o retorno proveyó payment_id
        if (paymentId && /^\d+$/.test(paymentId.trim())) {
          const mpRes = await fetcher(
            `https://api.mercadopago.com/v1/payments/${paymentId.trim()}`,
            {
              headers: { Authorization: `Bearer ${configDetection.config.accessToken}` },
              cache: "no-store"
            }
          );
          if (mpRes.ok) {
            mpPayment = await mpRes.json();
          }
        } else {
          // Caso B: Retorno abandonado — búsqueda server-to-server por external_reference
          const searchRes = await fetcher(
            `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(attempt.externalReference)}`,
            {
              headers: { Authorization: `Bearer ${configDetection.config.accessToken}` },
              cache: "no-store"
            }
          );
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (Array.isArray(searchData?.results) && searchData.results.length > 0) {
              mpPayment = searchData.results[0];
            }
          }
        }

        if (mpPayment) {
          const amountCents = BigInt(Math.round(Number(mpPayment.transaction_amount) * 100));

          // Verificación estricta de referencia externa, moneda y monto esperado
          if (
            mpPayment.external_reference === attempt.externalReference &&
            mpPayment.currency_id === "ARS" &&
            amountCents === attempt.expectedAmountCents
          ) {
            if (mpPayment.status === "approved") {
              await dependencies.attempts.markApproved(attempt.externalReference, String(mpPayment.id));
              const quote = await dependencies.quotes.findById(attempt.quoteId);
              const whatsappUrl = quote
                ? await getWhatsAppUrlForApprovedQuote(quote, String(mpPayment.id), dependencies.loadCatalog)
                : null;

              return {
                status: "approved",
                externalReference: attempt.externalReference,
                paymentReference: String(mpPayment.id),
                totalCents: attempt.expectedAmountCents.toString(),
                whatsappUrl
              };
            }

            if (mpPayment.status === "rejected" || mpPayment.status === "cancelled") {
              return {
                status: "rejected",
                message: "El pago fue rechazado por la entidad bancaria o cancelado."
              };
            }
          }
        }
      } catch {
        // En caso de fallo de red momentáneo con MP, continúa como pendiente
      }
    }
  }

  // 3. Verificación de expiración
  const quote = await dependencies.quotes.findById(attempt.quoteId);
  if (quote && now > quote.expiresAt) {
    return { status: "expired" };
  }

  // 4. Continúa pendiente de verificación
  return {
    status: "pending",
    verifying: true
  };
}
