import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import { ADMIN_LOGIN_PATH, logout } from "../actions";
import styles from "../admin.module.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  const currentAdmin = await getCurrentStoreAdmin();
  if (!currentAdmin.ok) redirect(ADMIN_LOGIN_PATH);

  const role = currentAdmin.value.role === "owner" ? "Owner" : "Admin";
  return (
    <main className={styles.adminViewport}>
      <header className={styles.adminHeader}>
        <a className={styles.brand} href="/" aria-label="Búnker Burger, volver al menú">
          <span aria-hidden="true">BB</span>
          <strong>BÚNKER BURGER</strong>
        </a>
        <div className={styles.adminActions}>
          <span className={styles.role}>{role}</span>
          <form action={logout}>
            <button className={styles.secondaryAction} type="submit">Cerrar sesión</button>
          </form>
        </div>
      </header>
      <div className={styles.adminContent}>{children}</div>
    </main>
  );
}
