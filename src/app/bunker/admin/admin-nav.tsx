"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../admin.module.css";
import { ADMIN_SECTIONS } from "./paths";

/** Admin sections plus the public menu, which stays the same for a signed-in admin. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Administración" className={styles.adminNav}>
      {ADMIN_SECTIONS.map((section) => (
        <Link aria-current={pathname === section.href || pathname.startsWith(`${section.href}/`) ? "page" : undefined} className={styles.tab} href={section.href} key={section.href}>
          {section.label}
        </Link>
      ))}
      <Link className={styles.tab} href="/">
        Ver menú
      </Link>
    </nav>
  );
}
