import Link from "next/link";
import styles from "../admin.module.css";
import { ADMIN_SECTIONS } from "./paths";

const DESCRIPTIONS: Record<(typeof ADMIN_SECTIONS)[number]["href"], string> = {
  "/bunker/admin/catalogo": "Categorías, productos, opciones y fotos.",
  "/bunker/admin/tienda": "Estado del local, horarios, delivery, WhatsApp y medios de pago.",
  "/bunker/admin/promociones": "Promociones, su prioridad y su calendario."
};

export default function AdminHomePage() {
  return (
    <section className={styles.adminPanel} aria-labelledby="admin-title">
      <p className={styles.eyebrow}>BÚNKER BURGER</p>
      <h1 id="admin-title">Panel administrativo</h1>
      <p>Configuración del menú y del local.</p>
      <ul className={styles.sectionLinks}>
        {ADMIN_SECTIONS.map((section) => (
          <li key={section.href}>
            <Link className={styles.primaryLink} href={section.href}>
              {section.label === "Catálogo" ? "Administrar catálogo" : section.label}
            </Link>
            <span className={styles.hint}>{DESCRIPTIONS[section.href]}</span>
          </li>
        ))}
      </ul>
      <Link className={styles.secondaryLink} href="/">
        Ver menú público
      </Link>
    </section>
  );
}
