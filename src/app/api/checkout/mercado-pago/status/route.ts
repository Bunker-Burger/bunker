import { getOperationalPublicCatalog } from "@/server/catalog";
import { checkMercadoPagoPaymentStatus } from "@/server/checkout/mercadopago-status";
import { getPaymentPersistencePorts } from "@/server/payments/payment-repository";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ref = searchParams.get("ref");
  const paymentId = searchParams.get("payment_id");

  const ports = getPaymentPersistencePorts();
  if (!ports) {
    return Response.json(
      { error: "unavailable", message: "El servicio de pagos no está disponible en este momento." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const statusResult = await checkMercadoPagoPaymentStatus(
    { ref, paymentId },
    {
      attempts: ports.attempts,
      quotes: ports.quotes,
      loadCatalog: () => getOperationalPublicCatalog()
    }
  );

  const headers = { "Cache-Control": "no-store" };

  if (statusResult.status === "invalid_reference") {
    return Response.json(
      { error: "invalid_reference", message: "Referencia de pago inválida" },
      { status: 400, headers }
    );
  }

  if (statusResult.status === "not_found") {
    return Response.json(
      { error: "not_found", message: "Intento de pago no encontrado" },
      { status: 404, headers }
    );
  }

  return Response.json(statusResult, { headers });
}
