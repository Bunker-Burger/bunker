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

export interface SearchPaymentsResult {
  ok: boolean;
  complete: boolean;
  results: Array<Record<string, unknown>>;
}

export async function searchMercadoPagoPayments(
  externalReference: string,
  accessToken: string,
  fetcher: typeof fetch,
  options?: { limit?: number; maxPages?: number }
): Promise<SearchPaymentsResult> {
  const allResults: Array<Record<string, unknown>> = [];
  let offset = 0;
  const limit = options?.limit ?? 30;
  const maxPages = options?.maxPages ?? 5;
  let page = 0;

  try {
    while (true) {
      page += 1;
      const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&offset=${offset}&limit=${limit}`;
      const res = await fetcher(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store"
      });

      if (!res.ok) {
        return { ok: false, complete: false, results: allResults };
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return { ok: false, complete: false, results: allResults };
      }

      const raw = data as { results?: unknown; paging?: { total?: unknown } };
      if (!Array.isArray(raw?.results)) {
        return { ok: true, complete: false, results: allResults };
      }

      allResults.push(...raw.results);

      // P2-06C: Si falta metadata de paging o total no es número válido, la consulta no es íntegra.
      // NUNCA asumir total = 0 si falta metadata.
      if (typeof raw.paging?.total !== "number" || raw.paging.total < 0) {
        return { ok: true, complete: false, results: allResults };
      }

      const total = raw.paging.total;
      offset += raw.results.length;

      if (offset >= total || raw.results.length === 0) {
        const isComplete = offset >= total;
        return { ok: true, complete: isComplete, results: allResults };
      }

      if (page >= maxPages) {
        // P2-06C: Si se alcanzó maxPages pero aún quedan resultados por consultar (offset < total),
        // la búsqueda es PARCIAL, nunca completa!
        return { ok: true, complete: false, results: allResults };
      }
    }
  } catch {
    return { ok: false, complete: false, results: allResults };
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

  // 1. Estados ya terminales en base de datos
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

  if (attempt.status === "rejected") {
    return {
      status: "rejected",
      message: "El pago fue rechazado por la pasarela o cancelado."
    };
  }

  if (attempt.status === "expired") {
    return { status: "expired" };
  }

  // 2. Reconciliación server-to-server con Mercado Pago
  const quote = await dependencies.quotes.findById(attempt.quoteId);
  const quoteExpired = Boolean(quote && now > quote.expiresAt);

  const detectConfig = dependencies.detectConfig ?? detectMercadoPagoConfig;
  const configDetection = detectConfig();

  if (configDetection.enabled) {
    const fetcher = dependencies.fetcher ?? fetch;
    let providerError = false;
    const candidateList: Array<Record<string, unknown>> = [];
    let searchNeeded = true;

    // Caso A: El cliente proveyó payment_id numérico
    if (paymentId && /^\d+$/.test(paymentId.trim())) {
      try {
        const mpRes = await fetcher(
          `https://api.mercadopago.com/v1/payments/${paymentId.trim()}`,
          {
            headers: { Authorization: `Bearer ${configDetection.config.accessToken}` },
            cache: "no-store"
          }
        );
        if (mpRes.ok) {
          const single = (await mpRes.json()) as Record<string, unknown>;
          if (single && typeof single === "object") {
            const matchesRef = single.external_reference === attempt.externalReference;
            const matchesCurrency = single.currency_id === "ARS";
            const amountCents = BigInt(Math.round(Number(single.transaction_amount) * 100));
            const matchesAmount = amountCents === attempt.expectedAmountCents;

            if (matchesRef && matchesCurrency && matchesAmount) {
              candidateList.push(single);
              searchNeeded = false;
            } else {
              // P2-06D: payment_id ajeno o discrepante (otra ref, moneda o monto).
              // No concluyente: fallback a búsqueda server-to-server por la referencia real persistida.
              searchNeeded = true;
            }
          }
        } else if (mpRes.status === 404) {
          // P2-06D: payment_id inexistente (404). No concluyente: fallback a búsqueda por ref.
          searchNeeded = true;
        } else if (mpRes.status >= 500) {
          providerError = true;
          searchNeeded = false;
        }
      } catch {
        searchNeeded = true;
      }
    }

    if (searchNeeded && !providerError) {
      // Caso B o Fallback P2-06D: Búsqueda server-to-server por external_reference
      const searchRes = await searchMercadoPagoPayments(
        attempt.externalReference,
        configDetection.config.accessToken,
        fetcher
      );
      if (!searchRes.ok || !searchRes.complete) {
        // P2-06C: Si la consulta a MP fue parcial, cortada por maxPages, timeout o metadata errónea,
        // NUNCA inferir ausencia ni declarar expired ni rejected.
        // Retornar estado indeterminado pending de verificación.
        return { status: "pending", verifying: true };
      }
      candidateList.push(...searchRes.results);
    }

    if (!providerError && candidateList.length > 0) {
      // P2-06A: Filtrar y validar candidatos estrictamente por external_reference, currency_id ARS y transaction_amount
      const validMatching = candidateList.filter((candidate) => {
        const matchesRef = candidate.external_reference === attempt.externalReference;
        const matchesCurrency = candidate.currency_id === "ARS";
        const amountCents = BigInt(Math.round(Number(candidate.transaction_amount) * 100));
        const matchesAmount = amountCents === attempt.expectedAmountCents;
        return matchesRef && matchesCurrency && matchesAmount;
      });

      const approvedCandidates = validMatching.filter((c) => c.status === "approved");
      const pendingCandidates = validMatching.filter((c) =>
        c.status === "pending" || c.status === "in_process" || c.status === "in_mediation"
      );
      const rejectedCandidates = validMatching.filter((c) =>
        c.status === "rejected" || c.status === "cancelled"
      );

      // P2-06A: Si hay aprobados, verificar que no haya ambigüedad (múltiples IDs de pago distintos aprobados)
      if (approvedCandidates.length > 0) {
        const distinctApprovedIds = new Set(approvedCandidates.map((c) => String(c.id)));
        if (distinctApprovedIds.size > 1) {
          // Ambigüedad no resuelta: múltiples pagos aprobados contradictorios
          return { status: "pending", verifying: true };
        }

        const approvedPayment = approvedCandidates[0]!;
        await dependencies.attempts.markApproved(attempt.externalReference, String(approvedPayment.id));
        const whatsappUrl = quote
          ? await getWhatsAppUrlForApprovedQuote(quote, String(approvedPayment.id), dependencies.loadCatalog)
          : null;

        return {
          status: "approved",
          externalReference: attempt.externalReference,
          paymentReference: String(approvedPayment.id),
          totalCents: attempt.expectedAmountCents.toString(),
          whatsappUrl
        };
      }

      // P2-06B: Si hay pago iniciado y PENDIENTE en MP (ej. boleto offline), NUNCA declarar expirado
      // aun cuando hayan transcurrido > 15 min de la quote
      if (pendingCandidates.length > 0) {
        return { status: "pending", verifying: true };
      }

      // Si todos los candidatos válidos fueron rechazados o cancelados (sin pending ni approved)
      if (rejectedCandidates.length > 0) {
        return {
          status: "rejected",
          message: "El pago fue rechazado por la pasarela o cancelado."
        };
      }
    }

    // P2-06B: Si ocurrió un error de red o caída del proveedor de pagos,
    // mantener en verificación y NO declarar expirado
    if (providerError) {
      return { status: "pending", verifying: true };
    }

    // P2-06B: Si la búsqueda confirmó ausencia REAL de pago (0 pagos iniciados) y la cotización expiró
    if (quoteExpired) {
      return { status: "expired" };
    }
  } else {
    // Si la pasarela está deshabilitada y la cotización expiró
    if (quoteExpired) {
      return { status: "expired" };
    }
  }

  // 3. Continúa pendiente de verificación
  return {
    status: "pending",
    verifying: true
  };
}
