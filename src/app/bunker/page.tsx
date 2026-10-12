import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import { ADMIN_HOME_PATH } from "./paths";
import styles from "./admin.module.css";
import { LoginForm } from "./login-form";

export default async function BunkerLoginPage() {
  await connection();
  const currentAdmin = await getCurrentStoreAdmin();
  if (currentAdmin.ok) redirect(ADMIN_HOME_PATH);

  return (
    <main className={styles.viewport}>
      <section aria-labelledby="admin-login-title" className={styles.card}>
        <Link aria-label="Búnker Burger, volver al menú" className={styles.brand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element -- 80px brand mark, already sized */}
          <img alt="" height={40} src="/assets/bunker-logo.webp" width={40} />
          <strong>BÚNKER BURGER</strong>
        </Link>
        <div className={styles.heading}>
          <p>ACCESO PRIVADO</p>
          <h1 id="admin-login-title">Administración</h1>
          <span>Ingresá con la cuenta aprovisionada para el local.</span>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
