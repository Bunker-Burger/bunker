"use client";

import { useRef } from "react";
import styles from "@/app/bunker/admin.module.css";

/**
 * Open or close the store, as the capture's switch: on sets "Abierto", off sets "Cerrado". Pausing
 * or going back to the opening hours stays on the store screen.
 */
export function StoreSwitch({ open, reason }: { open: boolean; reason: string }) {
  const override = useRef<HTMLInputElement>(null);
  return (
    <label className={styles.storeSwitch}>
      <span>{open ? "Local abierto · recibiendo pedidos" : `Local cerrado · ${reason}`}</span>
      <input name="statusOverride" ref={override} type="hidden" defaultValue={open ? "open" : "closed"} />
      <input
        aria-label="Local abierto"
        defaultChecked={open}
        onChange={(event) => {
          if (override.current) override.current.value = event.currentTarget.checked ? "open" : "closed";
          event.currentTarget.form?.requestSubmit();
        }}
        type="checkbox"
      />
    </label>
  );
}
