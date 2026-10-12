"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@/components/storefront/storefront.css";
import { PromoBanner, PromoSection } from "@/components/storefront/promo-showcase";
import type { PromotionMechanic, PromotionRule } from "@/domain/types";
import styles from "../../admin.module.css";

/**
 * "Así se verá en la carta" for a promotion (issue #54): the menu's banner slide and section
 * card, fed with what the form says right now. Only promotions with a photo reach the menu.
 */
export function PromotionPreview({
  badge,
  mechanic,
  items,
  photoUrl
}: {
  badge: string;
  mechanic: PromotionMechanic | null;
  items: PromotionRule["items"];
  photoUrl: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const field = form.elements.namedItem("name");
    const read = () => setName(field instanceof HTMLInputElement ? field.value.trim() : "");
    read();
    form.addEventListener("input", read);
    return () => form.removeEventListener("input", read);
  }, []);

  const rule = mechanic
    ? ({
        id: "vista-previa",
        slug: "vista-previa",
        name: name || "Nombre de la promoción",
        description: "",
        badgeText: badge || null,
        imageUrl: photoUrl,
        priority: 0,
        active: true,
        startsAt: new Date(0),
        endsAt: new Date(0),
        mechanic,
        channels: ["delivery", "pickup"],
        items,
        schedule: []
      } satisfies PromotionRule)
    : null;

  return (
    <section aria-labelledby="menu-preview-title" className={styles.previewCard} ref={ref}>
      <h2 className={styles.cardTitle} id="menu-preview-title">
        <Eye aria-hidden="true" size={20} /> Así se verá en la carta
      </h2>
      {!photoUrl ? (
        <p className={styles.hint}>Subí una foto para verla: sin foto la promo no aparece arriba de la carta (igual se aplica sola en el pedido).</p>
      ) : !rule ? (
        <p className={styles.hint}>Completá la mecánica para ver la vista previa.</p>
      ) : (
        <>
          <p className={styles.hint}>Se muestra mientras la promoción está vigente. Se actualiza mientras completás el formulario.</p>
          <div className={styles.previewCards} inert>
            <span className={styles.previewLabel}>Banner arriba de la carta</span>
            <PromoBanner label="Vista previa del banner" promotions={[rule]} />
            <span className={styles.previewLabel}>Sección “Promociones”</span>
            <PromoSection promotions={[rule]} />
          </div>
        </>
      )}
    </section>
  );
}
