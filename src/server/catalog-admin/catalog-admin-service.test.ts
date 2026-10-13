// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryAdminAccess, type InMemorySession } from "@/server/catalog/in-memory-admin-access";
import {
  createCategory,
  deleteCategory,
  deleteProduct,
  deleteProductImage,
  deletePromotionImage,
  moveCategory,
  moveProduct,
  reorderCategories,
  reorderOptions,
  reorderProducts,
  saveOption,
  saveProduct,
  saveProductImage,
  savePromotionImage,
  updateCategory,
  type CatalogAdminDependencies
} from "./catalog-admin-service";
import { InMemoryCatalogAdminRepository } from "./in-memory-catalog-admin-repository";
import { corruptMiddle, realImage, truncate } from "./test-images";

const STORE = "0199b2c8-40b0-7000-8000-000000000001";
const OTHER_STORE = "0199b2c8-40b0-7000-8000-000000000999";
const SLUG = "bunker-burger";
const OWNER = "11111111-1111-4111-8111-111111111111";

const BURGERS = "0199b2c8-40b0-7000-8000-000000000101";
const SANDWICHES = "0199b2c8-40b0-7000-8000-000000000102";
const DRINKS = "0199b2c8-40b0-7000-8000-000000000104";
const SIZE = "0199b2c8-40b0-7000-8000-000000000301";
const EXTRAS = "0199b2c8-40b0-7000-8000-000000000302";
const DOUBLE = "0199b2c8-40b0-7000-8000-000000000401";
const TRIPLE = "0199b2c8-40b0-7000-8000-000000000402";
const BACON = "0199b2c8-40b0-7000-8000-000000000403";
const PICKLES = "0199b2c8-40b0-7000-8000-000000000406";
const SMASH = "0199b2c8-40b0-7000-8000-000000000201";
const OKLAHOMA = "0199b2c8-40b0-7000-8000-000000000203";
const FOREIGN = "0199b2c8-40b0-7000-8000-000000000299";

let repository: InMemoryCatalogAdminRepository;
let log: { error: ReturnType<typeof vi.fn<(message: string) => void>> };

function deps(session: InMemorySession = { userId: OWNER }, active = true): CatalogAdminDependencies {
  return {
    repository,
    access: createInMemoryAdminAccess(session, [{ userId: OWNER, storeId: STORE, storeSlug: SLUG, role: "owner", active }]),
    storeSlug: SLUG,
    newId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    log
  };
}

function form(fields: Record<string, string | string[] | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const smashForm = (overrides: Record<string, string | string[]> = {}) =>
  form({
    productId: SMASH,
    categoryId: BURGERS,
    name: "Smash Búnker Doble",
    slug: "smash-bunker-doble",
    description: "Dos medallones smash.",
    price: "7800",
    inStock: "on",
    published: "on",
    optionGroup: [SIZE],
    [`default:${SIZE}`]: [DOUBLE],
    ...overrides
  });

/** Signature + IHDR 800×600 and padding: looks like a PNG, has no pixel data (no IDAT/IEND). */
function headerOnlyPng() {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  return new Uint8Array([...header, 0, 0, 3, 32, 0, 0, 2, 88, 8, 6, 0, 0, 0, ...new Array(64).fill(0)]);
}

const real = {} as Record<"png" | "jpeg" | "webp" | "avif" | "tiny", Uint8Array<ArrayBuffer>>;
beforeAll(async () => {
  for (const format of ["png", "jpeg", "webp", "avif"] as const) real[format] = await realImage(format);
  real.tiny = await realImage("png", 100, 100);
}, 60_000);

beforeEach(() => {
  log = { error: vi.fn<(message: string) => void>() };
  repository = new InMemoryCatalogAdminRepository();
  repository.categories = [
    { id: BURGERS, storeId: STORE, name: "Hamburguesas", slug: "hamburguesas", kind: "burger", sortOrder: 10, visible: true },
    { id: SANDWICHES, storeId: STORE, name: "Sándwiches", slug: "sandwiches", kind: "sandwich", sortOrder: 20, visible: true },
    { id: DRINKS, storeId: STORE, name: "Bebidas", slug: "bebidas", kind: "drink", sortOrder: 40, visible: true }
  ];
  repository.optionGroups = [
    {
      storeId: STORE,
      id: SIZE,
      name: "Tamaño",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      applicableTypes: ["burger"],
      options: [
        { id: DOUBLE, name: "Doble", priceDeltaCents: 0n, available: true },
        { id: TRIPLE, name: "Triple", priceDeltaCents: 160000n, available: true }
      ]
    },
    {
      storeId: STORE,
      id: EXTRAS,
      name: "Extras",
      selectionMode: "multiple",
      required: false,
      minSelections: 0,
      maxSelections: 2,
      applicableTypes: ["burger", "sandwich"],
      options: [
        { id: BACON, name: "Bacon", priceDeltaCents: 90000n, available: true },
        { id: PICKLES, name: "Pepinillos", priceDeltaCents: 30000n, available: false }
      ]
    }
  ];
  repository.products = [
    {
      id: SMASH, storeId: STORE, categoryId: BURGERS, name: "Smash Búnker Doble", slug: "smash-bunker-doble", description: "Dos medallones smash.",
      priceCents: 780000n, inStock: true, featured: true, published: true, sortOrder: 10, containsAlcohol: false,
      optionGroups: [{ groupId: SIZE, defaultOptionIds: [DOUBLE] }]
    },
    {
      id: OKLAHOMA, storeId: STORE, categoryId: BURGERS, name: "Oklahoma Onion", slug: "oklahoma-onion", description: "Cebolla.",
      priceCents: 720000n, inStock: true, featured: false, published: true, sortOrder: 20, containsAlcohol: false, optionGroups: []
    },
    {
      id: FOREIGN, storeId: OTHER_STORE, categoryId: BURGERS, name: "Ajena", slug: "ajena", description: "De otra tienda.",
      priceCents: 100000n, inStock: true, featured: false, published: true, sortOrder: 10, containsAlcohol: false, optionGroups: []
    }
  ];
});

describe("authorization", () => {
  it.each([
    ["no session", null, true],
    ["an expired session", { userId: OWNER, expired: true }, true],
    ["a user without membership", { userId: "22222222-2222-4222-8222-222222222222" }, true],
    ["an inactive membership", { userId: OWNER }, false]
  ])("refuses every write with %s and touches nothing", async (_case, session, active) => {
    const d = deps(session, active);
    const outcomes = await Promise.all([
      createCategory(d, form({ kind: "burger", name: "Nueva" })),
      updateCategory(d, form({ categoryId: BURGERS, name: "X" })),
      deleteCategory(d, form({ categoryId: SANDWICHES })),
      moveCategory(d, form({ categoryId: BURGERS, direction: "down" })),
      saveProduct(d, smashForm({ price: "1" })),
      moveProduct(d, form({ productId: SMASH, direction: "down" })),
      deleteProduct(d, form({ productId: OKLAHOMA })),
      saveProductImage(d, form({ productId: SMASH, image: new File([real.png], "a.png", { type: "image/png" }) })),
      deleteProductImage(d, form({ productId: SMASH }))
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toEqual({ ok: false, message: "Tu sesión no tiene permisos de administración. Volvé a iniciar sesión." });
    }
    expect(repository.writes).toEqual([]);
    expect(repository.objects.size).toBe(0);
  });

  it("takes the store from the membership, never from the form", async () => {
    const outcome = await createCategory(deps(), form({ kind: "burger", name: "Smash", storeId: OTHER_STORE, store_id: OTHER_STORE }));
    expect(outcome.ok).toBe(true);
    expect(repository.categories.at(-1)).toMatchObject({ storeId: STORE, name: "Smash" });
  });

  it("cannot reach another store's product by id", async () => {
    const outcome = await deleteProduct(deps(), form({ productId: FOREIGN }));
    expect(outcome).toEqual({ ok: false, message: "Ese elemento ya no existe. Recargá la página." });
    expect(repository.products.some((product) => product.id === FOREIGN)).toBe(true);
  });

  it("logs the cause without exposing it to the admin", async () => {
    repository.failing.set("listCategories", { code: "unavailable", message: "connect ECONNREFUSED 10.0.0.1" });
    const outcome = await createCategory(deps(), form({ kind: "burger", name: "Nueva" }));
    expect(outcome).toEqual({ ok: false, message: "No pudimos guardar los cambios. Intentá nuevamente." });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
  });
});

describe("categories", () => {
  it("creates a category at the end of the menu with a slug from its name", async () => {
    const outcome = await createCategory(deps(), form({ kind: "side", name: "Papas Fritas", visible: "on" }));
    expect(outcome).toMatchObject({ ok: true, message: "Categoría “Papas Fritas” creada." });
    expect(repository.categories.at(-1)).toMatchObject({ kind: "side", slug: "papas-fritas", visible: true, sortOrder: 50 });
  });

  it.each([["other"], ["drinks"], [""]])("only accepts the four admin kinds (%j)", async (kind) => {
    const outcome = await createCategory(deps(), form({ kind, name: "X" }));
    expect(outcome).toMatchObject({ ok: false, fieldErrors: { kind: expect.any(String) } });
    expect(repository.writes).toEqual([]);
  });

  it("reports a taken slug", async () => {
    const outcome = await createCategory(deps(), form({ kind: "burger", name: "Hamburguesas" }));
    expect(outcome).toEqual({ ok: false, message: "Ya existe una categoría con ese slug." });
  });

  it("updates name, slug and visibility but never the kind", async () => {
    const outcome = await updateCategory(deps(), form({ categoryId: BURGERS, name: "Burgers", slug: "burgers", kind: "drink" }));
    expect(outcome.ok).toBe(true);
    expect(repository.categories[0]).toMatchObject({ name: "Burgers", slug: "burgers", visible: false, kind: "burger" });
  });

  it("refuses to delete a category that still has products", async () => {
    const outcome = await deleteCategory(deps(), form({ categoryId: BURGERS }));
    expect(outcome).toEqual({ ok: false, message: "La categoría tiene productos: movelos o eliminalos antes de borrarla." });
    expect(repository.categories).toHaveLength(3);
  });

  it("deletes an empty category", async () => {
    expect(await deleteCategory(deps(), form({ categoryId: SANDWICHES }))).toMatchObject({ ok: true, message: "Categoría eliminada." });
    expect(repository.categories.map((category) => category.id)).toEqual([BURGERS, DRINKS]);
  });

  it("moves a category by swapping and renumbering only what changed", async () => {
    await moveCategory(deps(), form({ categoryId: DRINKS, direction: "up" }));
    expect(repository.writes).toEqual([`setCategoryOrder:${DRINKS}=20,${SANDWICHES}=30`]);
    expect((await repository.listCategories(STORE)).ok && (await repository.listCategories(STORE))).toMatchObject({
      value: [{ id: BURGERS }, { id: DRINKS }, { id: SANDWICHES }]
    });
  });

  it("does nothing at the ends", async () => {
    expect(await moveCategory(deps(), form({ categoryId: BURGERS, direction: "up" }))).toMatchObject({ ok: true, message: "La categoría ya está en ese extremo." });
    expect(repository.writes).toEqual([]);
  });

  it("rejects malformed ids and directions", async () => {
    expect(await moveCategory(deps(), form({ categoryId: "1; drop table", direction: "up" }))).toMatchObject({ ok: false, fieldErrors: { categoryId: expect.any(String) } });
    expect(await moveCategory(deps(), form({ categoryId: BURGERS, direction: "sideways" }))).toMatchObject({ ok: false, fieldErrors: { direction: expect.any(String) } });
  });
});

describe("saving products", () => {
  it("publishes a valid configuration", async () => {
    const outcome = await saveProduct(deps(), smashForm({ price: "8100.50" }));
    expect(outcome).toEqual({ ok: true, message: "“Smash Búnker Doble” guardado y publicado.", value: { productId: SMASH } });
    expect(repository.products[0]).toMatchObject({ priceCents: 810050n, published: true, featured: false });
    // Same links: a single update, the product is never unpublished on the way.
    expect(repository.writes).toEqual([`updateProduct:${SMASH}:published=true`]);
  });

  it.each([
    ["no description", { description: " " }, "El producto debe tener una descripción."],
    ["a zero price", { price: "0" }, "El precio base debe ser mayor a cero para ser publicado."],
    ["a required group without default", { [`default:${SIZE}`]: [] }, "requiere al menos 1 default"],
    ["two defaults in a single-choice group", { [`default:${SIZE}`]: [DOUBLE, TRIPLE] }, "tiene múltiples defaults"],
    ["an unavailable default", { optionGroup: [SIZE, EXTRAS], [`default:${EXTRAS}`]: [PICKLES] }, "está agotada"],
    ["a default from another group", { [`default:${SIZE}`]: [BACON] }, "no existe en el grupo"]
  ])("refuses to publish with %s and writes nothing", async (_case, overrides, expected) => {
    const outcome = await saveProduct(deps(), smashForm(overrides));
    expect(outcome).toMatchObject({ ok: false, message: "No se puede publicar: corregí la configuración." });
    expect(outcome.ok === false && outcome.issues?.join(" ")).toContain(expected);
    expect(repository.writes).toEqual([]);
  });

  it("refuses a group that does not apply to the product type, even as a draft", async () => {
    const outcome = await saveProduct(deps(), smashForm({ categoryId: DRINKS, published: [], optionGroup: [EXTRAS], [`default:${EXTRAS}`]: [] }));
    expect(outcome).toMatchObject({ ok: false, message: "La configuración de opciones no es válida." });
    expect(outcome.ok === false && outcome.issues?.join(" ")).toContain("no es aplicable");
    expect(repository.writes).toEqual([]);
  });

  it("keeps an incomplete product as a draft", async () => {
    const outcome = await saveProduct(deps(), smashForm({ published: [], description: "", price: "0", [`default:${SIZE}`]: [] }));
    expect(outcome).toMatchObject({ ok: true, message: "“Smash Búnker Doble” guardado como borrador." });
    expect(repository.products[0]).toMatchObject({ published: false, priceCents: 0n });
  });

  it("unpublishes while it relinks option groups, then publishes the new configuration", async () => {
    const outcome = await saveProduct(deps(), smashForm({ optionGroup: [SIZE, EXTRAS], [`default:${SIZE}`]: [TRIPLE], [`default:${EXTRAS}`]: [BACON] }));
    expect(outcome.ok).toBe(true);
    expect(repository.writes).toEqual([
      `updateProduct:${SMASH}:published=false`,
      `replaceOptionGroups:${SMASH}:published=false`,
      `setProductPublished:${SMASH}:true`
    ]);
    expect(repository.products[0]?.optionGroups).toEqual([
      { groupId: SIZE, defaultOptionIds: [TRIPLE] },
      { groupId: EXTRAS, defaultOptionIds: [BACON] }
    ]);
  });

  it("leaves a draft (never a half-linked published product) when relinking fails", async () => {
    repository.failing.set("replaceOptionGroups", { code: "unavailable", message: "timeout" });
    const outcome = await saveProduct(deps(), smashForm({ optionGroup: [SIZE, EXTRAS], [`default:${EXTRAS}`]: [BACON] }));
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("El producto quedó como borrador") });
    expect(repository.products[0]?.published).toBe(false);
  });

  it("explains when the database refuses to publish", async () => {
    repository.failing.set("setProductPublished", { code: "rejected", message: "BB003" });
    const outcome = await saveProduct(deps(), smashForm({ optionGroup: [SIZE, EXTRAS], [`default:${EXTRAS}`]: [BACON] }));
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("Los cambios se guardaron como borrador") });
    expect(repository.products[0]?.published).toBe(false);
  });

  it("creates a product at the end of its category: draft, links, then publish", async () => {
    const created = form({
      categoryId: BURGERS, name: "Burger del Mes", description: "Edición limitada.", price: "9000", inStock: "on", published: "on",
      optionGroup: [SIZE], [`default:${SIZE}`]: [DOUBLE]
    });
    const outcome = await saveProduct(deps(), created);
    expect(outcome).toMatchObject({ ok: true, value: { productId: expect.any(String) } });
    const product = repository.products.find((candidate) => candidate.slug === "burger-del-mes");
    expect(product).toMatchObject({ sortOrder: 30, published: true, containsAlcohol: false });
    expect(repository.writes.map((write) => write.split(":")[0])).toEqual(["createProduct", "replaceOptionGroups", "setProductPublished"]);
  });

  it("stores drinks without alcohol and appends a moved product to its new category", async () => {
    const outcome = await saveProduct(deps(), form({ productId: OKLAHOMA, categoryId: DRINKS, name: "Agua", slug: "agua", description: "Sin gas.", price: "1500", published: "on", containsAlcohol: "on" }));
    expect(outcome.ok).toBe(true);
    expect(repository.products[1]).toMatchObject({ categoryId: DRINKS, containsAlcohol: false, sortOrder: 10 });
  });

  it("reports field errors without writing", async () => {
    const outcome = await saveProduct(deps(), smashForm({ name: "", price: "7.800,50", categoryId: "x" }));
    expect(outcome).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), price: expect.any(String), categoryId: expect.any(String) } });
    expect(repository.writes).toEqual([]);
  });

  it("rejects a category from another store or of another kind", async () => {
    repository.categories.push({ id: "0199b2c8-40b0-7000-8000-000000000105", storeId: STORE, name: "Combos", slug: "combos", kind: "other", sortOrder: 50, visible: true });
    for (const categoryId of ["0199b2c8-40b0-7000-8000-000000000105", "0199b2c8-40b0-7000-8000-000000000555"]) {
      expect(await saveProduct(deps(), smashForm({ categoryId }))).toMatchObject({ ok: false, fieldErrors: { categoryId: expect.any(String) } });
    }
    expect(repository.writes).toEqual([]);
  });

  it("reports a taken slug", async () => {
    expect(await saveProduct(deps(), smashForm({ slug: "oklahoma-onion" }))).toEqual({ ok: false, message: "Ya existe un producto con ese slug." });
  });
});

describe("ordering and deleting products", () => {
  it("moves a product inside its category", async () => {
    await moveProduct(deps(), form({ productId: OKLAHOMA, direction: "up" }));
    expect(repository.writes).toEqual([`setProductOrder:${OKLAHOMA}=10,${SMASH}=20`]);
  });

  it("refuses to delete a product that a promotion uses", async () => {
    repository.promotionProductIds.add(SMASH);
    expect(await deleteProduct(deps(), form({ productId: SMASH }))).toMatchObject({ ok: false, message: expect.stringContaining("promoción") });
    expect(repository.writes).toEqual([]);
  });

  it("deletes the product row first, then its stored photo", async () => {
    repository.images.push({ id: "img-1", productId: SMASH, storagePath: `${STORE}/smash.webp`, altText: "Smash", focalX: 50, focalY: 50 });
    repository.objects.set(`${STORE}/smash.webp`, { bytes: real.webp, contentType: "image/webp" });
    expect(await deleteProduct(deps(), form({ productId: SMASH }))).toMatchObject({ ok: true });
    expect(repository.writes).toEqual([`deleteProduct:${SMASH}`, `removeObjects:${STORE}/smash.webp`]);
  });

  it("still succeeds when only the file cleanup fails, and logs the orphan", async () => {
    repository.images.push({ id: "img-1", productId: SMASH, storagePath: `${STORE}/smash.webp`, altText: "Smash", focalX: 50, focalY: 50 });
    repository.failing.set("removeObjects", { code: "unavailable", message: "storage down" });
    expect(await deleteProduct(deps(), form({ productId: SMASH }))).toMatchObject({ ok: true });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("orphaned storage object"));
  });
});

describe("product photos", () => {
  const upload = (file: File, extra: Record<string, string> = {}) => form({ productId: SMASH, image: file, altText: "Smash doble", focalX: "30", focalY: "70", ...extra });

  it("uploads a new photo under the store folder with a name derived from the bytes", async () => {
    const outcome = await saveProductImage(deps(), upload(new File([real.png], "foto.svg", { type: "" })));
    expect(outcome).toMatchObject({ ok: true, message: "Foto agregada." });
    const path = `${STORE}/${SMASH}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
    expect(path).toMatch(/^[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(avif|jpe?g|png|webp)$/);
    expect(repository.objects.get(path)?.contentType).toBe("image/png");
    expect(repository.images).toEqual([expect.objectContaining({ storagePath: path, altText: "Smash doble", focalX: 30, focalY: 70 })]);
  });

  const DAMAGED = "dañado o incompleto";
  it.each([
    ["jpeg", "image/jpeg", "jpg"],
    ["webp", "image/webp", "webp"],
    ["avif", "image/avif", "avif"]
  ] as const)("uploads a real %s with the type and extension found in its bytes", async (format, mime, extension) => {
    expect(await saveProductImage(deps(), upload(new File([real[format]], "foto", { type: mime })))).toMatchObject({ ok: true });
    expect(repository.objects.get(`${STORE}/${SMASH}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.${extension}`)?.contentType).toBe(mime);
  });

  it.each([
    ["an SVG", () => new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "a.svg", { type: "image/svg+xml" }), "Formato no permitido"],
    ["a text file renamed to .png", () => new File(["hola"], "a.png", { type: "image/png" }), "Formato no permitido"],
    ["a PNG declared as JPEG", () => new File([real.png], "a.jpg", { type: "image/jpeg" }), "no coincide"],
    ["a tiny image", () => new File([real.tiny], "a.png", { type: "image/png" }), "el mínimo es 320 px"],
    ["a file over 5 MB", () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" }), "supera los 5 MB"],
    ["a PNG with signature + IHDR 800×600 but no IDAT/IEND", () => new File([headerOnlyPng()], "a.png", { type: "image/png" }), DAMAGED],
    ["a truncated JPEG", () => new File([truncate(real.jpeg, 0.6)], "a.jpg", { type: "image/jpeg" }), DAMAGED],
    ["a truncated WebP", () => new File([truncate(real.webp, 0.6)], "a.webp", { type: "image/webp" }), DAMAGED],
    ["a truncated AVIF", () => new File([truncate(real.avif, 0.6)], "a.avif", { type: "image/avif" }), DAMAGED],
    ["a PNG with corrupted pixel data", () => new File([corruptMiddle(real.png)], "a.png", { type: "image/png" }), DAMAGED]
  ])("rejects %s on the server without uploading", async (_case, makeFile, message) => {
    const outcome = await saveProductImage(deps(), upload(makeFile()));
    expect(outcome).toMatchObject({ ok: false, fieldErrors: { image: expect.stringContaining(message) } });
    expect(repository.objects.size).toBe(0);
    expect(repository.writes).toEqual([]);
  });

  it("replaces a photo: new object, then the row, then the old object", async () => {
    repository.images.push({ id: "img-1", productId: SMASH, storagePath: `${STORE}/old.webp`, altText: "Vieja", focalX: 50, focalY: 50 });
    repository.objects.set(`${STORE}/old.webp`, { bytes: real.webp, contentType: "image/webp" });
    expect(await saveProductImage(deps(), upload(new File([real.png], "nueva.png", { type: "image/png" })))).toMatchObject({ ok: true, message: "Foto reemplazada." });
    const path = `${STORE}/${SMASH}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
    expect(repository.writes).toEqual([`putObject:${path}`, `savePrimaryImage:${path}`, `removeObjects:${STORE}/old.webp`]);
    expect([...repository.objects.keys()]).toEqual([path]);
  });

  it("removes the uploaded object when the row cannot be saved, keeping the old photo", async () => {
    repository.images.push({ id: "img-1", productId: SMASH, storagePath: `${STORE}/old.webp`, altText: "Vieja", focalX: 50, focalY: 50 });
    repository.objects.set(`${STORE}/old.webp`, { bytes: real.webp, contentType: "image/webp" });
    repository.failing.set("savePrimaryImage", { code: "unavailable", message: "timeout" });
    expect(await saveProductImage(deps(), upload(new File([real.png], "nueva.png", { type: "image/png" })))).toMatchObject({ ok: false });
    expect([...repository.objects.keys()]).toEqual([`${STORE}/old.webp`]);
    expect(repository.images[0]?.storagePath).toBe(`${STORE}/old.webp`);
  });

  it("updates only the alt text and focal point when no file is sent", async () => {
    repository.images.push({ id: "img-1", productId: SMASH, storagePath: `${STORE}/old.webp`, altText: "Vieja", focalX: 50, focalY: 50 });
    expect(await saveProductImage(deps(), form({ productId: SMASH, altText: "", focalX: "10", focalY: "90" }))).toMatchObject({ ok: true });
    expect(repository.images[0]).toMatchObject({ altText: "Smash Búnker Doble", focalX: 10, focalY: 90, storagePath: `${STORE}/old.webp` });
  });

  it("asks for a file when there is no photo yet", async () => {
    expect(await saveProductImage(deps(), form({ productId: SMASH }))).toMatchObject({ ok: false, fieldErrors: { image: "Elegí una imagen." } });
  });

  it.each([["-1"], ["101"], ["12.5"], ["abc"]])("rejects a focal point of %s", async (value) => {
    expect(await saveProductImage(deps(), upload(new File([real.png], "a.png", { type: "image/png" }), { focalX: value }))).toMatchObject({ ok: false, fieldErrors: { focalX: expect.any(String) } });
    expect(repository.objects.size).toBe(0);
  });

  it("deletes the row before the stored file", async () => {
    repository.images.push({ id: "img-1", productId: SMASH, storagePath: `${STORE}/old.webp`, altText: "Vieja", focalX: 50, focalY: 50 });
    expect(await deleteProductImage(deps(), form({ productId: SMASH }))).toMatchObject({ ok: true, message: "Foto eliminada." });
    expect(repository.writes).toEqual(["deleteImage:img-1", `removeObjects:${STORE}/old.webp`]);
  });
});

describe("options and their price (issue #54)", () => {
  it("adds an option to a group of the store, e.g. one more medallion", async () => {
    const outcome = await saveOption(deps(), form({ groupId: EXTRAS, name: "Medallón de carne", price: "1400", available: "true" }));
    expect(outcome.ok).toBe(true);
    const extras = repository.optionGroups.find((group) => group.id === EXTRAS)!;
    expect(extras.options.at(-1)).toMatchObject({ name: "Medallón de carne", priceDeltaCents: 140000n, available: true });
  });

  it("renames an option and changes its extra price; without 'available' it is paused", async () => {
    const outcome = await saveOption(deps(), form({ groupId: SIZE, optionId: DOUBLE, name: "Simple", price: "0", available: "true" }));
    expect(outcome.ok).toBe(true);
    const size = repository.optionGroups.find((group) => group.id === SIZE)!;
    expect(size.options[0]).toMatchObject({ id: DOUBLE, name: "Simple", priceDeltaCents: 0n, available: true });

    await saveOption(deps(), form({ groupId: EXTRAS, optionId: BACON, name: "Bacon", price: "950" }));
    expect(repository.optionGroups.find((group) => group.id === EXTRAS)!.options[0]).toMatchObject({ priceDeltaCents: 95000n, available: false });
  });

  it("refuses an option of another group, a repeated name, a bad price and a non-admin", async () => {
    const wrongGroup = await saveOption(deps(), form({ groupId: EXTRAS, optionId: DOUBLE, name: "Doble", price: "0" }));
    expect(wrongGroup.ok === false && wrongGroup.fieldErrors?.optionId).toBeTruthy();
    const repeated = await saveOption(deps(), form({ groupId: SIZE, name: "triple", price: "100" }));
    expect(repeated.ok === false && repeated.fieldErrors?.name).toContain("ya tiene una opción con ese nombre");
    const badPrice = await saveOption(deps(), form({ groupId: SIZE, name: "Cuádruple", price: "-5" }));
    expect(badPrice.ok === false && badPrice.fieldErrors?.price).toBeTruthy();
    const stranger = await saveOption(deps({ userId: "22222222-2222-4222-8222-222222222222" }), form({ groupId: SIZE, name: "Cuádruple", price: "100" }));
    expect(stranger.ok).toBe(false);
    expect(repository.optionGroups.find((group) => group.id === SIZE)!.options).toHaveLength(2);
  });

  it("saves a new order with every option of the group exactly once", async () => {
    const outcome = await reorderOptions(deps(), form({ groupId: SIZE, optionId: [TRIPLE, DOUBLE] }));
    expect(outcome.ok).toBe(true);
    expect(repository.optionGroups.find((group) => group.id === SIZE)!.options.map((option) => option.id)).toEqual([TRIPLE, DOUBLE]);

    for (const optionId of [[TRIPLE], [TRIPLE, TRIPLE], [TRIPLE, BACON]]) {
      const refused = await reorderOptions(deps(), form({ groupId: SIZE, optionId }));
      expect(refused.ok).toBe(false);
    }
  });
});

describe("drag-and-drop order from the panel (issue #54)", () => {
  it("orders the menu's sections with every category once", async () => {
    expect((await reorderCategories(deps(), form({ categoryId: [DRINKS, BURGERS, SANDWICHES] }))).ok).toBe(true);
    const order = [...repository.categories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) => category.id);
    expect(order).toEqual([DRINKS, BURGERS, SANDWICHES]);
    expect((await reorderCategories(deps(), form({ categoryId: [DRINKS, BURGERS] }))).ok).toBe(false);
  });

  it("orders the products of one category and refuses products of another category or store", async () => {
    expect((await reorderProducts(deps(), form({ categoryId: BURGERS, productId: [OKLAHOMA, SMASH] }))).ok).toBe(true);
    const burgers = repository.products.filter((product) => product.categoryId === BURGERS && product.storeId === STORE).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(burgers.map((product) => product.id)).toEqual([OKLAHOMA, SMASH]);
    expect((await reorderProducts(deps(), form({ categoryId: BURGERS, productId: [OKLAHOMA, FOREIGN] }))).ok).toBe(false);
  });
});

describe("promotion photo for the menu banner (issue #54)", () => {
  const PROMO = "0199b2c8-40b0-7000-8000-000000000501";
  const FOREIGN_PROMO = "0199b2c8-40b0-7000-8000-000000000599";
  const path = `${STORE}/promotions/${PROMO}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
  const upload = (promotionId = PROMO) => form({ promotionId, image: new File([real.png], "banner.png", { type: "image/png" }) });

  beforeEach(() => {
    repository.promotions = [
      { id: PROMO, storeId: STORE, name: "Martes de Smash", imagePath: null },
      { id: FOREIGN_PROMO, storeId: OTHER_STORE, name: "Ajena", imagePath: null }
    ];
  });

  it("uploads the photo under the store's promotions folder, matching the column's check", async () => {
    expect(await savePromotionImage(deps(), upload())).toMatchObject({ ok: true, message: "Foto agregada." });
    expect(path).toMatch(/^[0-9a-f-]{36}\/promotions\/[^/]+$/);
    expect(repository.objects.get(path)?.contentType).toBe("image/png");
    expect(repository.promotions[0]?.imagePath).toBe(path);
  });

  it("replaces a photo: new object, then the row, then the old object", async () => {
    repository.promotions[0]!.imagePath = `${STORE}/promotions/old.webp`;
    repository.objects.set(`${STORE}/promotions/old.webp`, { bytes: real.webp, contentType: "image/webp" });
    expect(await savePromotionImage(deps(), upload())).toMatchObject({ ok: true, message: "Foto reemplazada." });
    expect(repository.writes).toEqual([`putObject:${path}`, `setPromotionImage:${path}`, `removeObjects:${STORE}/promotions/old.webp`]);
  });

  it("removes the uploaded object when the row cannot be saved", async () => {
    repository.failing.set("setPromotionImage", { code: "unavailable", message: "timeout" });
    expect(await savePromotionImage(deps(), upload())).toMatchObject({ ok: false });
    expect(repository.objects.size).toBe(0);
    expect(repository.promotions[0]?.imagePath).toBeNull();
  });

  it("rejects a file that is not an accepted image without uploading", async () => {
    const outcome = await savePromotionImage(deps(), form({ promotionId: PROMO, image: new File(["hola"], "a.png", { type: "image/png" }) }));
    expect(outcome).toMatchObject({ ok: false, fieldErrors: { image: expect.stringContaining("Formato no permitido") } });
    expect(repository.writes).toEqual([]);
  });

  it("asks for a file", async () => {
    expect(await savePromotionImage(deps(), form({ promotionId: PROMO }))).toMatchObject({ ok: false, fieldErrors: { image: "Elegí una imagen." } });
  });

  it("does not touch a promotion of another store", async () => {
    expect(await savePromotionImage(deps(), upload(FOREIGN_PROMO))).toMatchObject({ ok: false, message: "Ese elemento ya no existe. Recargá la página." });
    expect(repository.writes).toEqual([]);
  });

  it("explains that the migration is missing instead of uploading a file it cannot reference", async () => {
    repository.promotionImagesSupported = false;
    expect(await savePromotionImage(deps(), upload())).toMatchObject({ ok: false, message: expect.stringContaining("migración") });
    expect(repository.writes).toEqual([]);
  });

  it("clears the path before removing the stored file", async () => {
    repository.promotions[0]!.imagePath = `${STORE}/promotions/old.webp`;
    expect(await deletePromotionImage(deps(), form({ promotionId: PROMO }))).toMatchObject({ ok: true, message: "Foto eliminada." });
    expect(repository.writes).toEqual(["setPromotionImage:null", `removeObjects:${STORE}/promotions/old.webp`]);
  });

  it("stores where the banner centres a new photo", async () => {
    const data = upload();
    data.set("focalX", "20");
    data.set("focalY", "80");
    expect(await savePromotionImage(deps(), data)).toMatchObject({ ok: true });
    expect(repository.promotions[0]?.focal).toEqual({ x: 20, y: 80 });
  });

  it("recentres the stored photo without uploading anything", async () => {
    repository.promotions[0]!.imagePath = `${STORE}/promotions/old.webp`;
    expect(await savePromotionImage(deps(), form({ promotionId: PROMO, focalX: "10", focalY: "90" }))).toMatchObject({ ok: true, message: "Foto acomodada." });
    expect(repository.writes).toEqual(["setPromotionFocal:10,90"]);
    expect(repository.objects.size).toBe(0);
  });

  it("uploads without framing on a database without the framing migration", async () => {
    repository.promotionFocalSupported = false;
    expect(await savePromotionImage(deps(), upload())).toMatchObject({ ok: true });
    expect(repository.promotions[0]?.focal).toBeUndefined();
    repository.promotions[0]!.imagePath = path;
    expect(await savePromotionImage(deps(), form({ promotionId: PROMO, focalX: "10", focalY: "90" }))).toMatchObject({ ok: false, message: expect.stringContaining("migración") });
  });

  it("refuses without an admin session", async () => {
    expect(await savePromotionImage(deps(null), upload())).toMatchObject({ ok: false });
    expect(repository.writes).toEqual([]);
  });
});
