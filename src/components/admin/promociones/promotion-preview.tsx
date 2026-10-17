"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@/components/storefront/storefront.css";
import { ComboSection, isCombo } from "@/components/storefront/promo/combo-section";
import { PromoBanner, PromoSection } from "@/components/storefront/promo/promo-cards";
import type { PromotionMechanic, PromotionRule } from "@/domain/types";
import styles from "@/app/bunker/admin.module.css";

export interface PreviewProduct {
  id: string;
  name: string;
  priceCents: string;
}

const NOOP = () => undefined;

/**
 * "Así se verá en la carta" for a promotion (issue #54), fed with what the form says right now: the
 * banner slide and the section card, with the photo or, without one, the tile with an icon. A combo
 * also gets its card of the "Combos" section.
 */
export function PromotionPreview({
  badge,
  mechanic,
  items,
  photoUrl,
  focal,
  products
}: {
  badge: string;
  focal: { x: number; y: number };
  mechanic: PromotionMechanic | null;
  items: PromotionRule["items"];
  photoUrl: string | null;
  products: readonly PreviewProduct[];
}) {
  const ref = useRef<HTMLElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const field = form.elements.namedItem("name");
    const text = form.elements.namedItem("description");
    const read = () => {
      setName(field instanceof HTMLInputElement ? field.value.trim() : "");
      setDescription(text instanceof HTMLTextAreaElement ? text.value.trim() : "");
    };
    read();
    form.addEventListener("input", read);
    return () => form.removeEventListener("input", read);
  }, []);

  const rule = mechanic
    ? ({
        id: "vista-previa",
        slug: "vista-previa",
        name: name || "Nombre de la promoción",
        description,
        badgeText: badge || null,
        imageUrl: photoUrl,
        imageFocalPoint: focal,
        priority: 0,
        active: true,
        startsAt: new Date(0),
        endsAt: new Date("2999-01-01T00:00:00Z"),
        mechanic,
        channels: ["delivery", "pickup"],
        items,
        schedule: []
      } satisfies PromotionRule)
    : null;

  const priced = products.map((product) => ({ id: product.id, name: product.name, priceCents: BigInt(product.priceCents) }));
  const combo = rule !== null && isCombo(rule);

  return (
    <section aria-labelledby="menu-preview-title" className={styles.previewCard} ref={ref}>
      <h2 className={styles.cardTitle} id="menu-preview-title">
        <Eye aria-hidden="true" size={20} /> Así se verá en la carta
      </h2>
      {!rule ? (
        <p className={styles.hint}>Completá la mecánica para ver la vista previa.</p>
      ) : (
        <>
          <p className={styles.hint}>Se muestra mientras la promoción está vigente. Se actualiza mientras completás el formulario.</p>
          <div className={styles.previewCards} inert>
            <span className={styles.previewLabel}>Banner arriba de la carta</span>
            <PromoBanner label="Vista previa del banner" promotions={[rule]} />
            <span className={styles.previewLabel}>Sección “Promociones”</span>
            <PromoSection promotions={[rule]} />
            {combo ? (
              <>
                <span className={styles.previewLabel}>Sección “Combos”</span>
                <ComboSection combos={[rule]} onAdd={NOOP} products={priced} />
              </>
            ) : null}
          </div>
          {!photoUrl ? <p className={styles.hint}>Sin foto se muestra con un ícono. Subí una foto para lucirla en el banner.</p> : null}
        </>
      )}
    </section>
  );
}
