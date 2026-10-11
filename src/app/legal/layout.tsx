import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_OWNER, LEGAL_PAGES, LEGAL_REVIEW, LEGAL_TEXTS_UPDATED_AT } from "@/content/legal";
import styles from "./legal.module.css";

/* BB-18: public legal pages (terms, privacy, cancellations). Plain text, no catalog or order data. */

const pending = "pendiente de carga por el titular";

export default function LegalLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles.legal}>
      <header className={styles.header}>
        <Link className={styles.back} href="/" prefetch={false}>
          ← Volver a la carta
        </Link>
        <p className={styles.eyebrow}>BÚNKER BURGER</p>
      </header>
      {LEGAL_REVIEW.approved ? null : (
        <p className={styles.review} role="note">
          Texto en revisión: todavía no fue aprobado por el titular ni revisado por un profesional.
        </p>
      )}
      <main className={styles.content}>{children}</main>
      <footer className={styles.footer}>
        <p>Última actualización: {LEGAL_TEXTS_UPDATED_AT}.</p>
        <p>
          Titular: {LEGAL_OWNER.legalName ?? pending}. CUIT: {LEGAL_OWNER.taxId ?? pending}. Domicilio:{" "}
          {LEGAL_OWNER.address ?? pending}.
        </p>
        <nav aria-label="Textos legales">
          <ul>
            {LEGAL_PAGES.map((page) => (
              <li key={page.href}>
                <Link href={page.href} prefetch={false}>
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}
