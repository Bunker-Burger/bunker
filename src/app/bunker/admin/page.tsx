import Link from "next/link";
import styles from "../admin.module.css";
import { ADMIN_CATALOG_PATH } from "./catalogo/form-state";

export default function AdminHomePage() {
  return (
    <section className={styles.adminPanel} aria-labelledby="admin-title">
      <p className={styles.eyebrow}>BÚNKER BURGER</p>
      <h1 id="admin-title">Panel administrativo</h1>
      <p>Gestioná el catálogo del menú: categorías, productos, opciones y fotos.</p>
      <Link className={styles.primaryLink} href={ADMIN_CATALOG_PATH}>Administrar catálogo</Link>{" "}
      <Link className={styles.secondaryLink} href="/">Ver menú público</Link>
    </section>
  );
}
