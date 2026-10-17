"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@/components/storefront/storefront.css";
import { layoutFor, ProductCard } from "@/components/storefront/menu";
import type { Product, ProductType } from "@/domain/types";
import styles from "@/app/bunker/admin.module.css";
import type { ProductFormCategory } from "./product-form";

export interface PhotoView {
  url: string | null;
  focal: { x: number; y: number };
}

interface Fields {
  name: string;
  description: string;
  priceCents: bigint;
  categoryId: string;
  inStock: boolean;
  featured: boolean;
}

const TYPES = new Set<ProductType>(["burger", "sandwich", "fries", "beverage", "other"]);

/** Pesos as typed in the price field ("7800" or "7800.5") → cents; anything else shows $ 0. */
function cents(value: string): bigint {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")) : 0n;
}

function readFields(form: HTMLFormElement): Fields {
  const data = new FormData(form);
  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    name: text("name"),
    description: text("description"),
    priceCents: cents(text("price")),
    categoryId: text("categoryId"),
    inStock: data.has("inStock"),
    featured: data.has("featured")
  };
}

/**
 * "Así se verá en la carta" (issue #54): the menu's own card, fed with what the form says right
 * now, so the admin sees the product as customers will before saving. Read-only: it is inert.
 */
export function ProductPreview({ categories, photo }: { categories: ProductFormCategory[]; photo: PhotoView }) {
  const ref = useRef<HTMLElement>(null);
  const [fields, setFields] = useState<Fields | null>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let frame = 0;
    // Some fields keep their value in state first (category pills): read after React updates.
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setFields(readFields(form)));
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  const category = categories.find((candidate) => candidate.id === fields?.categoryId) ?? null;
  const type = category && TYPES.has(category.type as ProductType) ? (category.type as ProductType) : "burger";
  const product = {
    id: "vista-previa",
    slug: "vista-previa",
    name: fields?.name || "Nombre del producto",
    description: fields?.description || "La descripción del producto aparece acá.",
    type,
    categoryId: category?.id ?? "",
    priceCents: fields?.priceCents ?? 0n,
    imageUrl: photo.url,
    ...(photo.url ? { imageFocalPoint: photo.focal } : {}),
    published: true,
    featured: fields?.featured ?? false,
    inStock: fields?.inStock ?? true,
    optionGroups: []
  } satisfies Product;

  return (
    <section aria-labelledby="menu-preview-title" className={styles.previewCard} ref={ref}>
      <h2 className={styles.cardTitle} id="menu-preview-title">
        <Eye aria-hidden="true" size={20} /> Así se verá en la carta
      </h2>
      <p className={styles.hint}>Se actualiza mientras completás el formulario. Las promociones vigentes se suman solas.</p>
      <div className={styles.previewCards} inert>
        {product.featured ? <span className={styles.previewLabel}>En “Las más pedidas”</span> : null}
        {product.featured ? (
          <ProductCard categoryName={category?.name ?? null} layout="hero" onAdd={() => {}} onOpen={() => {}} product={product} promotion={null} />
        ) : null}
        {product.featured ? <span className={styles.previewLabel}>En {category?.name ?? "su categoría"}</span> : null}
        <ProductCard categoryName={category?.name ?? null} layout={layoutFor(product, false)} onAdd={() => {}} onOpen={() => {}} product={product} promotion={null} />
      </div>
    </section>
  );
}
