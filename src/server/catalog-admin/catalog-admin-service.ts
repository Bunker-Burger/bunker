import { validateProductPublication } from "@/domain/options";
import type { OptionGroup, Product, PublicationErrorCode } from "@/domain/types";
import type { AdminAccessGate } from "@/server/catalog/admin-access";
import type { CatalogError } from "@/server/catalog/errors";
import { inspectImage, MAX_IMAGE_BYTES } from "./image";
import {
  parseCategoryForm,
  parseCategoryKind,
  parseDirection,
  parseId,
  parseImageDetails,
  parseProductForm,
  type FieldErrors
} from "./input";
import {
  ADMIN_CATEGORY_KINDS,
  PRODUCT_TYPE_BY_KIND,
  type AdminCategoryKind,
  type AdminError,
  type CatalogAdminRepository,
  type OptionGroupLink,
  type OrderedRow,
  type StoredProduct
} from "./ports";

/*
 * Catalog administration use cases. Each one first confirms, through the same gate as the admin
 * pages (auth.getUser + an active admin_memberships row), that the session administers the
 * store, and takes the store id from that membership, never from the form. RLS re-checks every
 * write in the database. Results carry a message for the admin; error details only go to logs.
 */

export interface CatalogAdminDependencies {
  repository: CatalogAdminRepository;
  access: AdminAccessGate;
  storeSlug: string;
  /** Random component of new storage paths. */
  newId?: () => string;
  log?: Pick<Console, "error">;
}

export type AdminOutcome<T = undefined> =
  | { ok: true; message: string; value: T }
  | { ok: false; message: string; fieldErrors?: FieldErrors; issues?: string[] };

const GENERIC_FAILURE = "No pudimos guardar los cambios. Intentá nuevamente.";

const success = <T>(message: string, value: T): AdminOutcome<T> => ({ ok: true, message, value });
const invalid = (fieldErrors: FieldErrors): AdminOutcome<never> => ({ ok: false, message: "Revisá los datos marcados.", fieldErrors });

function failure(deps: CatalogAdminDependencies, operation: string, error: AdminError | CatalogError, messages: Partial<Record<string, string>> = {}): AdminOutcome<never> {
  (deps.log ?? console).error(`[catalog-admin:${operation}] ${error.code}: ${error.message}`);
  const message =
    messages[error.code] ??
    {
      unauthorized: "Tu sesión no tiene permisos de administración. Volvé a iniciar sesión.",
      not_found: "Ese elemento ya no existe. Recargá la página.",
      conflict: "Ya existe un elemento con ese slug.",
      rejected: "La base de datos rechazó los datos. Revisalos e intentá nuevamente."
    }[error.code as string] ??
    GENERIC_FAILURE;
  return { ok: false, message };
}

/** Runs `operation` with the store id of the verified admin, or fails without touching anything. */
async function asAdmin<T>(deps: CatalogAdminDependencies, name: string, operation: (storeId: string) => Promise<AdminOutcome<T>>) {
  const membership = await deps.access.requireStoreAdmin(deps.storeSlug);
  if (!membership.ok) return failure(deps, name, membership.error);
  return operation(membership.value.storeId);
}

function renumber<T extends OrderedRow>(rows: T[], id: string, direction: "up" | "down"): OrderedRow[] | null {
  const index = rows.findIndex((row) => row.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= rows.length) return null;
  const ordered = [...rows];
  [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
  return ordered
    .map((row, position) => ({ id: row.id, sortOrder: (position + 1) * 10, previous: row.sortOrder }))
    .filter((row) => row.sortOrder !== row.previous)
    .map(({ id: rowId, sortOrder }) => ({ id: rowId, sortOrder }));
}

const byProductOrder = (a: StoredProduct, b: StoredProduct) =>
  a.sortOrder - b.sortOrder || Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, "es");

const nextSortOrder = (rows: Array<{ sortOrder: number }>) => rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 10;

// ---------------------------------------------------------------------------------------------
// Categories

export function createCategory(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "createCategory", async (storeId) => {
    const kind = parseCategoryKind(form);
    if (!kind.ok) return invalid(kind.error);
    const fields = parseCategoryForm(form);
    if (!fields.ok) return invalid(fields.error);

    const categories = await deps.repository.listCategories(storeId);
    if (!categories.ok) return failure(deps, "createCategory", categories.error);
    const created = await deps.repository.createCategory(storeId, {
      ...fields.value,
      kind: kind.value,
      sortOrder: nextSortOrder(categories.value)
    });
    if (!created.ok) return failure(deps, "createCategory", created.error, { conflict: "Ya existe una categoría con ese slug." });
    return success(`Categoría “${fields.value.name}” creada.`, created.value);
  });
}

/** Name, slug and visibility; the kind (tab) of a category never changes. */
export function updateCategory(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "updateCategory", async (storeId) => {
    const id = parseId(form, "categoryId");
    if (!id.ok) return invalid(id.error);
    const fields = parseCategoryForm(form);
    if (!fields.ok) return invalid(fields.error);

    const updated = await deps.repository.updateCategory(storeId, id.value, fields.value);
    if (!updated.ok) return failure(deps, "updateCategory", updated.error, { conflict: "Ya existe una categoría con ese slug." });
    return success(`Categoría “${fields.value.name}” guardada.`, undefined);
  });
}

export function deleteCategory(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "deleteCategory", async (storeId) => {
    const id = parseId(form, "categoryId");
    if (!id.ok) return invalid(id.error);

    const products = await deps.repository.listProducts(storeId, id.value);
    if (!products.ok) return failure(deps, "deleteCategory", products.error);
    if (products.value.length > 0) {
      return { ok: false, message: "La categoría tiene productos: movelos o eliminalos antes de borrarla." } as const;
    }
    const deleted = await deps.repository.deleteCategory(storeId, id.value);
    if (!deleted.ok) {
      return failure(deps, "deleteCategory", deleted.error, { conflict: "La categoría tiene productos: movelos o eliminalos antes de borrarla." });
    }
    return success("Categoría eliminada.", undefined);
  });
}

export function moveCategory(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "moveCategory", async (storeId) => {
    const id = parseId(form, "categoryId");
    if (!id.ok) return invalid(id.error);
    const direction = parseDirection(form);
    if (!direction.ok) return invalid(direction.error);

    const categories = await deps.repository.listCategories(storeId);
    if (!categories.ok) return failure(deps, "moveCategory", categories.error);
    if (!categories.value.some((category) => category.id === id.value)) {
      return failure(deps, "moveCategory", { code: "not_found", message: "category not in store" });
    }
    const changes = renumber(categories.value, id.value, direction.value);
    if (!changes) return success("La categoría ya está en ese extremo.", undefined);
    const saved = await deps.repository.setCategoryOrder(storeId, changes);
    if (!saved.ok) return failure(deps, "moveCategory", saved.error);
    return success("Orden de categorías actualizado.", undefined);
  });
}

// ---------------------------------------------------------------------------------------------
// Products

/** Problems that make a configuration wrong even as a draft (drafts may still be incomplete). */
const STRUCTURAL: ReadonlySet<PublicationErrorCode> = new Set([
  "ALCOHOL_BEVERAGE",
  "INAPPLICABLE_OPTION_GROUP",
  "MISSING_DEFAULT_OPTION",
  "DEFAULT_DUPLICATES",
  "DEFAULT_EXCEEDS_MAX",
  "DEFAULT_SINGLE_SELECT_MULTIPLE"
]);

const sameLinks = (a: OptionGroupLink[], b: OptionGroupLink[]) => {
  const key = (links: OptionGroupLink[]) =>
    JSON.stringify(links.map((link) => [link.groupId, [...link.defaultOptionIds].sort()]).sort());
  return key(a) === key(b);
};

/**
 * Creates or updates a product with its option groups and defaults. The configuration is
 * validated with the same domain rules the storefront and checkout use; a product is only
 * stored as published when they all pass (and the database triggers re-check defaults).
 */
export function saveProduct(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin<{ productId: string }>(deps, "saveProduct", async (storeId) => {
    const existingId = form.get("productId") ? parseId(form, "productId") : null;
    if (existingId && !existingId.ok) return invalid(existingId.error);
    const parsed = parseProductForm(form);
    if (!parsed.ok) return invalid(parsed.error);
    const { fields, published, optionGroups: links } = parsed.value;

    const [categories, groups] = await Promise.all([
      deps.repository.listCategories(storeId),
      deps.repository.listOptionGroups(storeId)
    ]);
    if (!categories.ok) return failure(deps, "saveProduct", categories.error);
    if (!groups.ok) return failure(deps, "saveProduct", groups.error);

    const category = categories.value.find((candidate) => candidate.id === fields.categoryId);
    if (!category || !(ADMIN_CATEGORY_KINDS as readonly string[]).includes(category.kind)) {
      return invalid({ categoryId: "Elegí una categoría de Hamburguesas, Sándwiches, Papas o Bebidas." });
    }
    const groupsById = new Map(groups.value.map((group) => [group.id, group]));
    const optionGroups: OptionGroup[] = [];
    for (const link of links) {
      const group = groupsById.get(link.groupId);
      if (!group) return invalid({ optionGroups: "Un grupo de opciones ya no existe. Recargá la página." });
      optionGroups.push({ ...group, options: [...group.options], defaultOptionIds: link.defaultOptionIds });
    }

    const candidate: Product = {
      id: existingId?.value ?? "new",
      ...fields,
      type: PRODUCT_TYPE_BY_KIND[category.kind as AdminCategoryKind],
      imageUrl: null,
      published,
      containsAlcohol: false,
      optionGroups
    };
    const validation = validateProductPublication(candidate);
    if (!validation.ok) {
      const blocking = published ? validation.error : validation.error.filter((issue) => STRUCTURAL.has(issue.code));
      if (blocking.length > 0) {
        return {
          ok: false,
          message: published ? "No se puede publicar: corregí la configuración." : "La configuración de opciones no es válida.",
          issues: [...new Set(blocking.map((issue) => issue.message))]
        };
      }
    }

    const siblings = await deps.repository.listProducts(storeId, fields.categoryId);
    if (!siblings.ok) return failure(deps, "saveProduct", siblings.error);
    const conflict = { conflict: "Ya existe un producto con ese slug." };

    let productId: string;
    let linksChanged: boolean;
    if (existingId) {
      const existing = await deps.repository.getProduct(storeId, existingId.value);
      if (!existing.ok) return failure(deps, "saveProduct", existing.error);
      if (!existing.value) return failure(deps, "saveProduct", { code: "not_found", message: "product not in store" });
      productId = existing.value.id;
      linksChanged = !sameLinks(existing.value.optionGroups, links);
      const sortOrder = existing.value.categoryId === fields.categoryId ? undefined : nextSortOrder(siblings.value);
      // While the links change the product is a draft, so it is never published with a mix of
      // old and new defaults; it is published again only after the new links are stored.
      const updated = await deps.repository.updateProduct(storeId, productId, {
        ...fields,
        published: linksChanged ? false : published,
        ...(sortOrder === undefined ? {} : { sortOrder })
      });
      if (!updated.ok) return failure(deps, "saveProduct", updated.error, conflict);
    } else {
      const created = await deps.repository.createProduct(storeId, { ...fields, sortOrder: nextSortOrder(siblings.value) });
      if (!created.ok) return failure(deps, "saveProduct", created.error, conflict);
      productId = created.value.id;
      linksChanged = true;
    }

    if (linksChanged) {
      const relinked = await deps.repository.replaceOptionGroups(storeId, productId, links);
      if (!relinked.ok) {
        const outcome = failure(deps, "saveProduct", relinked.error);
        return { ...outcome, message: `El producto quedó como borrador: no pudimos guardar sus opciones. ${outcome.message}` };
      }
      if (published) {
        const publishedNow = await deps.repository.setProductPublished(storeId, productId, true);
        if (!publishedNow.ok) {
          const outcome = failure(deps, "saveProduct", publishedNow.error);
          return { ...outcome, message: `Los cambios se guardaron como borrador: no pudimos publicarlo. ${outcome.message}` };
        }
      }
    }
    return success(published ? `“${fields.name}” guardado y publicado.` : `“${fields.name}” guardado como borrador.`, { productId });
  });
}

export function moveProduct(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "moveProduct", async (storeId) => {
    const id = parseId(form, "productId");
    if (!id.ok) return invalid(id.error);
    const direction = parseDirection(form);
    if (!direction.ok) return invalid(direction.error);

    const product = await deps.repository.getProduct(storeId, id.value);
    if (!product.ok) return failure(deps, "moveProduct", product.error);
    if (!product.value) return failure(deps, "moveProduct", { code: "not_found", message: "product not in store" });
    const siblings = await deps.repository.listProducts(storeId, product.value.categoryId);
    if (!siblings.ok) return failure(deps, "moveProduct", siblings.error);

    const changes = renumber([...siblings.value].sort(byProductOrder), id.value, direction.value);
    if (!changes) return success("El producto ya está en ese extremo.", undefined);
    const saved = await deps.repository.setProductOrder(storeId, changes);
    if (!saved.ok) return failure(deps, "moveProduct", saved.error);
    return success("Orden de productos actualizado.", undefined);
  });
}

async function removeQuietly(deps: CatalogAdminDependencies, operation: string, paths: string[]) {
  const removed = await deps.repository.removeObjects(paths);
  // The rows no longer point at these files; a leftover object is only storage to clean up later.
  if (!removed.ok) (deps.log ?? console).error(`[catalog-admin:${operation}] orphaned storage object(s) ${paths.join(", ")}: ${removed.error.message}`);
}

export function deleteProduct(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "deleteProduct", async (storeId) => {
    const id = parseId(form, "productId");
    if (!id.ok) return invalid(id.error);

    const product = await deps.repository.getProduct(storeId, id.value);
    if (!product.ok) return failure(deps, "deleteProduct", product.error);
    if (!product.value) return failure(deps, "deleteProduct", { code: "not_found", message: "product not in store" });
    const inPromotion = await deps.repository.isProductInPromotion(storeId, id.value);
    if (!inPromotion.ok) return failure(deps, "deleteProduct", inPromotion.error);
    if (inPromotion.value) {
      return { ok: false, message: "El producto es parte de una promoción: quitalo de la promoción o despublicalo en lugar de eliminarlo." } as const;
    }
    const image = await deps.repository.getPrimaryImage(storeId, id.value);
    if (!image.ok) return failure(deps, "deleteProduct", image.error);

    const deleted = await deps.repository.deleteProduct(storeId, id.value);
    if (!deleted.ok) return failure(deps, "deleteProduct", deleted.error);
    if (image.value) await removeQuietly(deps, "deleteProduct", [image.value.storagePath]);
    return success(`“${product.value.name}” eliminado.`, undefined);
  });
}

// ---------------------------------------------------------------------------------------------
// Images

/**
 * Uploads or replaces the product photo, or only updates its alt text and focal point when no
 * file is sent. A replacement uploads a new object first, then repoints the row, then deletes
 * the old object: the menu never references a file that does not exist.
 */
export function saveProductImage(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "saveProductImage", async (storeId) => {
    const id = parseId(form, "productId");
    if (!id.ok) return invalid(id.error);
    const product = await deps.repository.getProduct(storeId, id.value);
    if (!product.ok) return failure(deps, "saveProductImage", product.error);
    if (!product.value) return failure(deps, "saveProductImage", { code: "not_found", message: "product not in store" });

    const details = parseImageDetails(form, product.value.name);
    if (!details.ok) return invalid(details.error);
    const current = await deps.repository.getPrimaryImage(storeId, id.value);
    if (!current.ok) return failure(deps, "saveProductImage", current.error);

    const file = form.get("image");
    const hasFile = typeof file === "object" && file !== null && file.size > 0;
    if (!hasFile) {
      if (!current.value) return invalid({ image: "Elegí una imagen." });
      const updated = await deps.repository.updateImageDetails(current.value.id, details.value);
      if (!updated.ok) return failure(deps, "saveProductImage", updated.error);
      return success("Foto actualizada.", undefined);
    }

    if (file.size > MAX_IMAGE_BYTES) return invalid({ image: "La imagen supera los 5 MB." });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = await inspectImage(bytes, file.type);
    if (!image.ok) return invalid({ image: image.error.message });

    const random = (deps.newId ?? (() => crypto.randomUUID()))();
    const path = `${storeId}/${id.value}-${random}.${image.value.extension}`;
    const uploaded = await deps.repository.putObject(path, bytes, image.value.mime);
    if (!uploaded.ok) return failure(deps, "saveProductImage", uploaded.error);

    const saved = await deps.repository.savePrimaryImage(id.value, current.value?.id ?? null, { ...details.value, storagePath: path });
    if (!saved.ok) {
      await removeQuietly(deps, "saveProductImage", [path]);
      return failure(deps, "saveProductImage", saved.error);
    }
    if (current.value) await removeQuietly(deps, "saveProductImage", [current.value.storagePath]);
    return success(current.value ? "Foto reemplazada." : "Foto agregada.", undefined);
  });
}

/** Removes the row first (the menu stops showing it), then the stored file. */
export function deleteProductImage(deps: CatalogAdminDependencies, form: FormData) {
  return asAdmin(deps, "deleteProductImage", async (storeId) => {
    const id = parseId(form, "productId");
    if (!id.ok) return invalid(id.error);
    const product = await deps.repository.getProduct(storeId, id.value);
    if (!product.ok) return failure(deps, "deleteProductImage", product.error);
    if (!product.value) return failure(deps, "deleteProductImage", { code: "not_found", message: "product not in store" });
    const image = await deps.repository.getPrimaryImage(storeId, id.value);
    if (!image.ok) return failure(deps, "deleteProductImage", image.error);
    if (!image.value) return success("El producto ya no tiene foto.", undefined);

    const deleted = await deps.repository.deleteImage(image.value.id);
    if (!deleted.ok) return failure(deps, "deleteProductImage", deleted.error);
    await removeQuietly(deps, "deleteProductImage", [image.value.storagePath]);
    return success("Foto eliminada.", undefined);
  });
}
