import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import styles from "./admin-shared.module.css";

/**
 * Top bar of the admin screens in the canonical captures (issue #54): round back arrow, the screen
 * title in amber and the logo. It replaces the panel header on these screens (see admin-shared.module.css).
 */
export function AdminPageBar({ backHref, backLabel, title, titleId }: { backHref: string; backLabel: string; title: string; titleId: string }) {
  return (
    <div className={styles.pageBar} data-page-bar="">
      <Link aria-label={backLabel} className={styles.pageBack} href={backHref}>
        <ArrowLeft aria-hidden="true" size={20} />
      </Link>
      <h1 id={titleId}>{title}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- 80px brand mark, already sized */}
      <img alt="" className={styles.pageLogo} height={40} src="/assets/bunker-logo.webp" width={40} />
    </div>
  );
}
