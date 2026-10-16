"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@/components/storefront/storefront.css";
import { ProductCard } from "@/components/storefront/menu";
import { ComboSection, isCombo, PromoBanner, PromoSection } from "@/components/storefront/promo-showcase";
import { promotionalPrice } from "@/domain/promotions";
import type { PromotionMechanic, PromotionRule, Product } from "@/domain/types";
import styles from "../../admin.module.css";

export interface PreviewProduct {
  id: string;
  name: string;
  priceCents: string;
}

const NOOP = () => undefined;

/**
 * "Así se verá en la carta" for a promotion (issue #54), fed with what the form says right now.
 * With a photo: the banner slide and the section card. A combo also gets its card of the "Combos"
 * section, photo or not. A promotion without a photo and that is not a combo reaches the menu as the
 * discounted price on the cards of its products, so that card is shown.
 */
export function PromotionPreview({
  badge,
  mechanic,
  items,
  photoUrl,
  focal,
  products,
  timezone
}: {
  badge: string;
  focal: { x: number; y: number };
  mechanic: PromotionMechanic | null;
  items: PromotionRule["items"];
  photoUrl: string | null;
  products: readonly PreviewProduct[];
  timezone: string;
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

  // The product whose card shows the discount: the first one the promotion names, or the first of the menu.
  const example = (() => {
    if (!rule || combo) return null;
    const named = items.map((item) => priced.find((product) => product.id === item.productId)).find(Boolean);
    const base = named ?? priced[0];
    if (!base) return null;
    const card = { ...base, slug: "ejemplo", categoryId: "", type: "burger", description: "", imageUrl: null, published: true, featured: false, inStock: true, optionGroups: [] } satisfies Product;
    const promotion = promotionalPrice(card, [rule], { now: new Date(), timezone, fulfilment: "pickup", deliveryCents: 0n });
    return { card, promotion };
  })();

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
            {photoUrl ? (
              <>
                <span className={styles.previewLabel}>Banner arriba de la carta</span>
                <PromoBanner label="Vista previa del banner" promotions={[rule]} />
                <span className={styles.previewLabel}>Sección “Promociones”</span>
                <PromoSection promotions={[rule]} />
              </>
            ) : null}
            {combo ? (
              <>
                <span className={styles.previewLabel}>Sección “Combos”</span>
                <ComboSection combos={[rule]} onAdd={NOOP} products={priced} />
              </>
            ) : null}
            {!photoUrl && !combo ? (
              example?.promotion ? (
                <>
                  <span className={styles.previewLabel}>En la tarjeta de “{example.card.name}”</span>
                  <ProductCard categoryName={null} layout="row" onAdd={NOOP} onOpen={NOOP} product={example.card} promotion={example.promotion} />
                </>
              ) : (
                <p className={styles.hint}>
                  Sin foto no aparece arriba de la carta, y esta promo no cambia el precio de las tarjetas: se aplica sola al armar el pedido. Subí una foto para mostrarla arriba.
                </p>
              )
            ) : null}
          </div>
          {!photoUrl && !combo ? <p className={styles.hint}>Sin foto no aparece arriba de la carta. Subí una foto para mostrarla en el banner.</p> : null}
        </>
      )}
    </section>
  );
}
