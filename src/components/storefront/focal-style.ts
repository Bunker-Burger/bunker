import type { CSSProperties } from "react";
import type { Product } from "@/domain/types";

/** Keeps the admin's focal point in view when the photo is cropped; centred (CSS default) without one. */
export function focalStyle(product: Pick<Product, "imageFocalPoint">): CSSProperties | undefined {
  const point = product.imageFocalPoint;
  return point ? { objectPosition: `${point.x}% ${point.y}%` } : undefined;
}
