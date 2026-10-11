import type { Metadata } from "next";
import Link from "next/link";
import { ALLERGEN_NOTICE, LEGAL_ROBOTS } from "@/content/legal";

export const dynamic = "force-static";

export const metadata: Metadata = { title: "Términos | Búnker Burger", robots: LEGAL_ROBOTS };

export default function TermsPage() {
  return (
    <>
      <h1>Términos de uso</h1>
      <p>
        Esta web es la carta online de Búnker Burger. Sirve para ver los productos y precios, armar un pedido y enviarlo
        al local por WhatsApp o, cuando el local lo tenga habilitado, pagarlo con Mercado Pago. No hace falta crear una
        cuenta.
      </p>

      <h2>Precios y total</h2>
      <p>
        Los precios están en pesos argentinos. El total lo calcula la web al momento de enviar o pagar el pedido, con los
        precios, promociones y costo de envío vigentes en ese momento. Si algo cambió desde que armaste el carrito, la web
        te avisa antes de enviarlo. Los productos agotados no se pueden pedir.
      </p>

      <h2>Confirmación del pedido</h2>
      <p>
        Enviar el mensaje de WhatsApp no confirma el pedido: lo confirma el local por ese mismo chat. Sólo se pueden
        enviar pedidos mientras el local está abierto. Si pagaste con Mercado Pago, la web te muestra el estado del pago y
        el local coordina la entrega por WhatsApp.
      </p>

      <h2>Entrega</h2>
      <p>
        Podés retirar en el local o, si el local lo ofrece, pedir delivery. La dirección y el horario de entrega se
        coordinan por WhatsApp. La web no informa ni garantiza tiempos de preparación o de entrega.
      </p>

      <h2>Pagos</h2>
      <p>
        Los medios de pago son los que el local tenga habilitados: efectivo, transferencia (el alias se pide por WhatsApp)
        y Mercado Pago. Los datos de tu tarjeta o cuenta los cargás en Mercado Pago: nunca pasan por esta web.
      </p>

      <h2>Comprobantes</h2>
      <p>
        La web no emite facturas ni otros comprobantes fiscales. El mensaje de WhatsApp y la pantalla de pago no son una
        factura. Si necesitás factura, pedísela al local por WhatsApp.
      </p>

      <h2>Alérgenos</h2>
      <p>
        {ALLERGEN_NOTICE} Las notas que agregás a un producto son un pedido al local, no una garantía de que se pueda
        preparar sin un ingrediente.
      </p>

      <h2>Cancelaciones, devoluciones y datos</h2>
      <p>
        Cómo cancelar un pedido y cómo se devuelve un pago está en{" "}
        <Link href="/legal/cancelaciones" prefetch={false}>Cancelaciones y devoluciones</Link>. Qué datos se usan y por
        cuánto tiempo está en <Link href="/legal/privacidad" prefetch={false}>Privacidad</Link>.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Nada de estos términos limita los derechos que te da la Ley de Defensa del Consumidor (Ley 24.240). Si estos
        textos cambian, se actualiza la fecha de esta página.
      </p>
    </>
  );
}
