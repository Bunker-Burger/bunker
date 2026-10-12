import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import { ADMIN_LOGIN_PATH } from "../paths";
import { AdminBottomNav } from "./admin-bottom-nav";
import { AdminNav } from "./admin-nav";
import { LogoutForm } from "./logout-form";
import styles from "../admin.module.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  const currentAdmin = await getCurrentStoreAdmin();
  if (!currentAdmin.ok) redirect(ADMIN_LOGIN_PATH);

  const role = currentAdmin.value.role === "owner" ? "Owner" : "Admin";
  return (
    <main className={styles.adminViewport}>
      <header className={styles.adminHeader}>
        <Link className={styles.brand} href="/" aria-label="Búnker Burger, volver al menú">
          {/* eslint-disable-next-line @next/next/no-img-element -- 80px brand mark, already sized */}
          <img alt="" height={40} src="/assets/bunker-logo.webp" width={40} />
          <strong>BÚNKER BURGER</strong>
        </Link>
        <div className={styles.adminActions}>
          <span className={styles.role}>{role}</span>
          <LogoutForm buttonClassName={styles.secondaryAction} />
        </div>
      </header>
      <div className={styles.adminContent}>
        <AdminNav />
        {children}
      </div>
      <AdminBottomNav />
    </main>
  );
}
