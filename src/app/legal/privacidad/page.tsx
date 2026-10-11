import type { Metadata } from "next";
import { getPublicCatalog } from "@/server/catalog";
import { resolvePrivacyContact, type PrivacyContact } from "@/server/legal/privacy-contact";
import { PAYMENT_DATA_RETENTION_NOTICE } from "@/content/legal";

export const metadata: Metadata = { title: "Privacidad | Búnker Burger" };

/*
 * Rendered on every request: the contact must not be frozen with whatever the catalog answered at
 * build time, and the configured fallback is read from the server environment.
 */
export const dynamic = "force-dynamic";

/*
 * BB-18: exactly what the site handles today. If a flow starts storing something new (a field, a
 * table, a cookie), this page changes in the same pull request.
 */

/** The store's WhatsApp from the catalog; null when the catalog cannot be read. */
async function storeWhatsapp(): Promise<string | null> {
  const catalog = await getPublicCatalog();
  return catalog.ok ? catalog.value.store.whatsappE164 : null;
}

function Contact({ contact }: { contact: PrivacyContact | null }) {
  if (!contact) return <strong>el canal de contacto para privacidad todavía no fue cargado por el titular</strong>;
  return <a href={contact.href}>{contact.label}</a>;
}

export default async function PrivacyPage() {
  const contact = resolvePrivacyContact(await storeWhatsapp(), {
    PRIVACY_CONTACT_WHATSAPP: process.env.PRIVACY_CONTACT_WHATSAPP,
    PRIVACY_CONTACT_EMAIL: process.env.PRIVACY_CONTACT_EMAIL
  });

  return (
    <>
      <h1>Privacidad</h1>
      <p>
        Búnker Burger es responsable de los datos que esta web usa para tomar tus pedidos. Para cualquier consulta o
        pedido sobre tus datos, escribinos: <Contact contact={contact} />.
      </p>

      <h2>Pedidos por WhatsApp</h2>
      <p>
        La web no te pide ni guarda datos personales: arma el mensaje con tu pedido y lo enviás vos desde WhatsApp. Tu
        nombre, la dirección de entrega y el pago se coordinan en ese chat, que queda en WhatsApp y en el teléfono del
        local. La web no copia esas conversaciones ni guarda direcciones.
      </p>

      <h2>Pagos con Mercado Pago</h2>
      <ul>
        <li>
          <strong>Qué datos:</strong> tu nombre y apellido y tu teléfono, junto con el detalle del pedido, el total y el
          estado del pago que informa Mercado Pago (número de pago, aprobado, rechazado o devuelto).
        </li>
        <li>
          <strong>Para qué:</strong> identificar tu pago, avisarle al local que el pedido está pagado y poder contactarte
          por la entrega o por una devolución.
        </li>
        <li>
          <strong>Con quién:</strong> tu nombre y teléfono se envían a Mercado Pago al crear el pago. Los datos de tu
          tarjeta o cuenta los cargás en Mercado Pago y nunca pasan por esta web.
        </li>
        <li>
          <strong>Cuánto tiempo:</strong> {PAYMENT_DATA_RETENTION_NOTICE} Lo que guarda Mercado Pago se rige
          por su propia política de privacidad.
        </li>
      </ul>

      <h2>En tu dispositivo</h2>
      <p>
        Tu carrito (productos, opciones y notas) se guarda en el almacenamiento de tu navegador para que no lo pierdas al
        cerrar la página; también se guarda si cerraste la invitación para instalar la app. No salen de tu dispositivo
        salvo cuando enviás o pagás un pedido, y se borran al borrar los datos del sitio en tu navegador. La web no usa
        cookies de seguimiento, analítica ni publicidad.
      </p>

      <h2>Datos técnicos</h2>
      <p>
        Como cualquier sitio, los proveedores que alojan la web (Vercel) y la base de datos (Supabase) registran datos
        técnicos de cada visita, como la dirección IP, para operar y proteger el servicio. Esos registros los conservan
        según sus propias políticas, y pueden estar fuera de Argentina.
      </p>

      <h2>Qué no hacemos</h2>
      <ul>
        <li>No usamos tus datos para publicidad ni te enviamos promociones.</li>
        <li>No vendemos ni cedemos tus datos.</li>
        <li>No guardamos direcciones ni creamos cuentas de clientes.</li>
      </ul>

      <h2>Tus derechos</h2>
      <p>
        Podés pedir acceso, rectificación o supresión de tus datos escribiendo a: <Contact contact={contact} />. El acceso es gratuito a intervalos no
        inferiores a seis meses, salvo que acredites un interés legítimo (art. 14, inc. 3, Ley 25.326).
      </p>
      <p>
        La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la
        atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
        incumplimiento de las normas vigentes en materia de protección de datos personales.
      </p>
    </>
  );
}
