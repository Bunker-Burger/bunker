import type { Catalog } from "@/domain/types";
import type { Result } from "@/lib/result";
import type { CatalogError } from "@/server/catalog/errors";
import {
  detectMercadoPagoConfig,
  type MercadoPagoConfigDetection
} from "@/server/payments/mercado-pago";
import type { PaymentAttemptsPort, PaymentQuotesPort } from "@/server/payments/ports";
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
    let whatsappUrl: string | null = null;

    if (quote && dependencies.loadCatalog) {
      const catalogResult = await dependencies.loadCatalog();
      if (catalogResult.ok) {
        try {
          whatsappUrl = buildApprovedMercadoPagoWhatsAppUrl({
            businessPhone: catalogResult.value.store.whatsappE164,
            fulfilment: "pickup",
            pricing: quote,
            paymentReference: attempt.providerPaymentId ?? attempt.externalReference
          });
        } catch {
          whatsappUrl = null;
        }
      }
    }

    return {
      status: "approved",
      externalReference: attempt.externalReference,
      paymentReference: attempt.providerPaymentId ?? attempt.externalReference,
      totalCents: attempt.expectedAmountCents.toString(),
      whatsappUrl
    };
  }

  // 2. Reconciliación server-to-server si el navegador presenta payment_id y sigue pendiente
  if (attempt.status === "pending" && paymentId && /^\d+$/.test(paymentId.trim())) {
    const detectConfig = dependencies.detectConfig ?? detectMercadoPagoConfig;
    const configDetection = detectConfig();

    if (configDetection.enabled) {
      const fetcher = dependencies.fetcher ?? fetch;
      try {
        const mpRes = await fetcher(
          `https://api.mercadopago.com/v1/payments/${paymentId.trim()}`,
          {
            headers: { Authorization: `Bearer ${configDetection.config.accessToken}` },
            cache: "no-store"
          }
        );

        if (mpRes.ok) {
          const mpData = await mpRes.json();
          const amountCents = BigInt(Math.round(Number(mpData.transaction_amount) * 100));

          // Verificación estricta de referencia externa, moneda y monto esperado
          if (
            mpData.external_reference === attempt.externalReference &&
            mpData.currency_id === "ARS" &&
            amountCents === attempt.expectedAmountCents
          ) {
            if (mpData.status === "approved") {
              await dependencies.attempts.markApproved(attempt.externalReference, String(mpData.id));
              const quote = await dependencies.quotes.findById(attempt.quoteId);
              let whatsappUrl: string | null = null;

              if (quote && dependencies.loadCatalog) {
                const catalogResult = await dependencies.loadCatalog();
                if (catalogResult.ok) {
                  try {
                    whatsappUrl = buildApprovedMercadoPagoWhatsAppUrl({
                      businessPhone: catalogResult.value.store.whatsappE164,
                      fulfilment: "pickup",
                      pricing: quote,
                      paymentReference: String(mpData.id)
                    });
                  } catch {
                    whatsappUrl = null;
                  }
                }
              }

              return {
                status: "approved",
                externalReference: attempt.externalReference,
                paymentReference: String(mpData.id),
                totalCents: attempt.expectedAmountCents.toString(),
                whatsappUrl
              };
            }

            if (mpData.status === "rejected" || mpData.status === "cancelled") {
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
