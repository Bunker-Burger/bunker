import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import { ADMIN_LOGIN_PATH } from "../paths";
import { AdminBottomNav } from "@/components/admin/shared/admin-bottom-nav";
import { LogoutForm } from "@/components/admin/shared/logout-form";
import styles from "../admin.module.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  const currentAdmin = await getCurrentStoreAdmin();
  if (!currentAdmin.ok) redirect(ADMIN_LOGIN_PATH);

  const role = currentAdmin.value.role === "owner" ? "Dueño" : "Encargado";
  return (
    <main className={styles.adminViewport}>
      <header className={styles.adminHeader}>
        <Link className={styles.brand} href="/" aria-label="Búnker Burguer, volver al menú">
          {/* eslint-disable-next-line @next/next/no-img-element -- 80px brand mark, already sized */}
          <img alt="" height={40} src="/assets/bunker-logo.webp" width={40} />
          <span className={styles.brandText}>
            <strong>BÚNKER BURGUER</strong>
            <small>
              Panel de control · <span>{role}</span>
            </small>
          </span>
        </Link>
        <div className={styles.adminActions}>
          <LogoutForm buttonClassName={styles.logoutAction} icon />
        </div>
      </header>
      <div className={styles.adminContent}>
        {children}
      </div>
      <AdminBottomNav />
    </main>
  );
}
