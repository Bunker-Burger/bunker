import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { ADMIN_CATEGORY_KINDS, type AdminCategoryKind, type CategoryFields, type ImageDetails, type OptionGroupLink, type ProductFields } from "./ports";

/*
 * Parses the admin forms (FormData) into typed fields. Nothing here trusts the browser: every
 * value is re-validated, ids must be UUIDs and the store is never taken from the form.
 */

export type { FieldErrors } from "@/server/admin/use-case";
import type { FieldErrors } from "@/server/admin/use-case";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Sándwich de Cerdo!" → "sandwich-de-cerdo". */
export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");
const checked = (value: FormDataEntryValue | null) => value === "on" || value === "true";

function slugFrom(form: FormData, name: string) {
  const raw = text(form.get("slug")).trim().toLowerCase();
  return raw === "" ? slugify(name) : raw;
}

function collect(issues: z.core.$ZodIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

const slugField = z.string().min(1, "Ingresá un slug.").max(80, "Máximo 80 caracteres.").regex(SLUG, "Sólo minúsculas, números y guiones.");
const uuidField = (message: string) => z.string().regex(UUID, message);

const categorySchema = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre.").max(60, "Máximo 60 caracteres."),
  slug: slugField,
  visible: z.boolean()
});

export function parseCategoryForm(form: FormData): Result<CategoryFields, FieldErrors> {
  const name = text(form.get("name"));
  const parsed = categorySchema.safeParse({ name, slug: slugFrom(form, name), visible: checked(form.get("visible")) });
  return parsed.success ? ok(parsed.data) : err(collect(parsed.error.issues));
}

export function parseCategoryKind(form: FormData): Result<AdminCategoryKind, FieldErrors> {
  const kind = text(form.get("kind"));
  return (ADMIN_CATEGORY_KINDS as readonly string[]).includes(kind)
    ? ok(kind as AdminCategoryKind)
    : err({ kind: "Elegí Hamburguesas, Sándwiches, Papas o Bebidas." });
}

export function parseId(form: FormData, field: string): Result<string, FieldErrors> {
  const value = text(form.get(field));
  return UUID.test(value) ? ok(value.toLowerCase()) : err({ [field]: "Identificador inválido." });
}

export function parseDirection(form: FormData): Result<"up" | "down", FieldErrors> {
  const value = text(form.get("direction"));
  return value === "up" || value === "down" ? ok(value) : err({ direction: "Dirección inválida." });
}

/** Pesos as typed in a number input ("7800" or "7800.50"), at most 9.999.999,99. */
const PRICE = /^\d{1,7}(?:\.\d{1,2})?$/;

export function parsePriceCents(raw: string): bigint | null {
  const value = raw.trim();
  if (!PRICE.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

const productSchema = z.object({
  categoryId: uuidField("Elegí una categoría."),
  name: z.string().trim().min(1, "Ingresá un nombre.").max(100, "Máximo 100 caracteres."),
  slug: slugField,
  description: z.string().trim().max(1000, "Máximo 1000 caracteres."),
  price: z.string().refine((value) => parsePriceCents(value) !== null, "Ingresá un precio en pesos, por ejemplo 7800 o 7800.50."),
  inStock: z.boolean(),
  featured: z.boolean(),
  published: z.boolean(),
  optionGroups: z
    .array(z.object({ groupId: uuidField("Grupo de opciones inválido."), defaultOptionIds: z.array(uuidField("Opción inválida.")).max(50) }))
    .max(30, "Demasiados grupos de opciones.")
    .refine((links) => new Set(links.map((link) => link.groupId)).size === links.length, "Un grupo de opciones está repetido.")
});

export interface ProductForm {
  fields: ProductFields;
  published: boolean;
  optionGroups: OptionGroupLink[];
}

/**
 * Option groups arrive as `optionGroup=<groupId>` (one per assigned group) and their defaults as
 * `default:<groupId>=<optionId>` (one per default option).
 */
export function parseProductForm(form: FormData): Result<ProductForm, FieldErrors> {
  const name = text(form.get("name"));
  const groupIds = form.getAll("optionGroup").map(text);
  const parsed = productSchema.safeParse({
    categoryId: text(form.get("categoryId")),
    name,
    slug: slugFrom(form, name),
    description: text(form.get("description")),
    price: text(form.get("price")),
    inStock: checked(form.get("inStock")),
    featured: checked(form.get("featured")),
    published: checked(form.get("published")),
    // An optional single-choice group sends "" for "Ninguna".
    optionGroups: groupIds.map((groupId) => ({
      groupId,
      defaultOptionIds: form.getAll(`default:${groupId}`).map(text).filter((id) => id !== "")
    }))
  });
  if (!parsed.success) return err(collect(parsed.error.issues));
  const { price, published, optionGroups, ...rest } = parsed.data;
  return ok({
    fields: { ...rest, categoryId: rest.categoryId.toLowerCase(), priceCents: parsePriceCents(price)! },
    published,
    optionGroups: optionGroups.map((link) => ({
      groupId: link.groupId.toLowerCase(),
      defaultOptionIds: link.defaultOptionIds.map((id) => id.toLowerCase())
    }))
  });
}

const percent = (message: string) => z.coerce.number().int(message).min(0, message).max(100, message);

const imageDetailsSchema = z.object({
  altText: z.string().trim().max(180, "Máximo 180 caracteres."),
  focalX: percent("El punto focal horizontal va de 0 a 100."),
  focalY: percent("El punto focal vertical va de 0 a 100.")
});

/** An empty alt text falls back to `fallbackAlt` (the product name). */
export function parseImageDetails(form: FormData, fallbackAlt: string): Result<ImageDetails, FieldErrors> {
  const parsed = imageDetailsSchema.safeParse({
    altText: text(form.get("altText")),
    focalX: text(form.get("focalX")) || "50",
    focalY: text(form.get("focalY")) || "50"
  });
  if (!parsed.success) return err(collect(parsed.error.issues));
  const altText = parsed.data.altText || fallbackAlt.trim().slice(0, 180);
  return ok({ ...parsed.data, altText });
}
