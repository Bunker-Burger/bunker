import type { Metadata } from "next";
import Link from "next/link";
import styles from "./offline.module.css";

/*
 * Precached by the service worker and shown when a page cannot be loaded without connection
 * (BB-16). Static and public: no catalog, prices, session or order data.
 */

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sin conexión | Búnker Burger",
  robots: { index: false, follow: false }
};

export default function OfflinePage() {
  return (
    <main className={styles.offline} aria-labelledby="offline-title">
      <p className={styles.eyebrow}>BÚNKER BURGER</p>
      <h1 id="offline-title">Sin conexión</h1>
      <p>No pudimos cargar esta página. Revisá tu conexión e intentá de nuevo.</p>
      <p>
        Si ya abriste la carta en este dispositivo, podés volver a verla. Para enviar o pagar un pedido necesitás internet:
        sin conexión no se envía ni se cobra nada.
      </p>
      <Link className={styles.action} href="/" prefetch={false}>
        Volver a la carta
      </Link>
    </main>
  );
}
