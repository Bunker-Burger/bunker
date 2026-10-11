import type { Metadata } from "next";
import { LEGAL_ROBOTS } from "@/content/legal";

export const dynamic = "force-static";

export const metadata: Metadata = { title: "Cancelaciones y devoluciones | Búnker Burger", robots: LEGAL_ROBOTS };

/* Mirrors the manual refund procedure of docs/runbooks/mercado-pago-webhook.md (§5): total refunds, no promised term. */

export default function CancellationsPage() {
  return (
    <>
      <h1>Cancelaciones y devoluciones</h1>

      <h2>Antes de enviar el pedido</h2>
      <p>
        Mientras no envíes el mensaje de WhatsApp ni pagues, no hay pedido: podés cambiar o vaciar el carrito cuando
        quieras.
      </p>

      <h2>Después de enviarlo por WhatsApp</h2>
      <p>
        Para cancelar o cambiar el pedido, escribile al local en el mismo chat. Si todavía no lo empezó a preparar, lo
        cancela. Si ya está en preparación o en camino, el local te dice por ese chat si se puede cancelar o cambiar.
      </p>

      <h2>Pagos con Mercado Pago</h2>
      <p>El local devuelve el pago completo desde Mercado Pago cuando:</p>
      <ul>
        <li>cancelás un pedido pagado que el local todavía no preparó;</li>
        <li>el local no puede preparar tu pedido;</li>
        <li>el pago no coincide con el total de tu pedido;</li>
        <li>se cobró dos veces el mismo pedido (se devuelve el pago repetido).</li>
      </ul>
      <p>
        La devolución la inicia el local y te avisa por WhatsApp. Cuándo ves el dinero depende de Mercado Pago y del medio
        con el que pagaste: no podemos prometerte un plazo. Si un pago queda pendiente o es rechazado, el pedido no se
        prepara.
      </p>

      <h2>Efectivo y transferencia</h2>
      <p>
        Si pagaste por transferencia y corresponde devolver el dinero, se coordina con el local por WhatsApp. Los pagos en
        efectivo se hacen al recibir o retirar el pedido.
      </p>
    </>
  );
}
