import Link from "next/link";
import styles from "../admin.module.css";

export default function AdminHomePage() {
  return (
    <section className={styles.adminPanel} aria-labelledby="admin-title">
      <p className={styles.eyebrow}>BÚNKER BURGER</p>
      <h1 id="admin-title">Panel administrativo</h1>
      <p>El acceso está protegido. La gestión del catálogo y las promociones se incorpora en las próximas etapas.</p>
      <Link className={styles.primaryLink} href="/">Ver menú público</Link>
    </section>
  );
}
