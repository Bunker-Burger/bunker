import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/supabase/database.types";
import { createSupabaseCatalogAdminRepository } from "./supabase-catalog-admin-repository";

/* Only the PostgREST/Storage transport is faked: the chain of calls each method builds is recorded. */

const STORE = "0199b2c8-40b0-7000-8000-000000000001";
const ID = "0199b2c8-40b0-7000-8000-000000000201";

interface Call {
  table: string;
  ops: unknown[][];
}

type Reply = { data?: unknown; error?: unknown; status?: number } | Error;

function fakeClient(reply: (call: Call) => Reply = () => ({ data: [{ id: ID }] })) {
  const calls: Call[] = [];
  const storage = {
    upload: vi.fn<(path: string, body: Uint8Array, options: object) => Promise<{ data: object; error: unknown }>>(async () => ({ data: {}, error: null })),
    remove: vi.fn<(paths: string[]) => Promise<{ data: unknown[]; error: unknown }>>(async () => ({ data: [], error: null }))
  };
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
                const result = reply(call);
                return result instanceof Error ? Promise.reject(result).then(resolve, reject) : Promise.resolve({ data: null, error: null, status: 200, ...result }).then(resolve, reject);
              };
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, ...args]);
              return builder;
            };
          }
        }
      );
      return builder;
    },
    storage: { from: vi.fn(() => storage) }
  };
  return { client: client as unknown as SupabaseClient<Database>, calls, storage };
}

const fields = { categoryId: ID, name: "Smash", slug: "smash", description: "Doble.", priceCents: 780000n, inStock: true, featured: false };
const op = (call: Call | undefined, name: string) => call?.ops.filter((entry) => entry[0] === name) ?? [];

describe("store scoping and affected rows", () => {
  it.each([
    ["updateCategory", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.updateCategory(STORE, ID, { name: "X", slug: "x", visible: true })],
    ["deleteCategory", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.deleteCategory(STORE, ID)],
    ["updateProduct", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.updateProduct(STORE, ID, fields)],
    ["setProductPublished", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.setProductPublished(STORE, ID, true)],
    ["deleteProduct", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.deleteProduct(STORE, ID)],
    ["setCategoryOrder", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.setCategoryOrder(STORE, [{ id: ID, sortOrder: 10 }])],
    ["setProductOrder", (repo: ReturnType<typeof createSupabaseCatalogAdminRepository>) => repo.setProductOrder(STORE, [{ id: ID, sortOrder: 10 }])]
  ])("%s filters by store and id and asks for the affected rows", async (_name, run) => {
    const { client, calls } = fakeClient();
    expect(await run(createSupabaseCatalogAdminRepository(client))).toEqual({ ok: true, value: undefined });
    expect(op(calls[0], "eq")).toEqual(expect.arrayContaining([["eq", "store_id", STORE], ["eq", "id", ID]]));
    expect(op(calls[0], "select")).toEqual([["select", "id"]]);
  });

  it("treats zero affected rows (RLS or another store) as not_found", async () => {
    const { client } = fakeClient(() => ({ data: [] }));
    const result = await createSupabaseCatalogAdminRepository(client).updateCategory(STORE, ID, { name: "X", slug: "x", visible: true });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("error mapping", () => {
  it.each([
    [{ code: "23505", message: "duplicate key" }, "conflict"],
    [{ code: "23503", message: "violates foreign key" }, "conflict"],
    [{ code: "BB012", message: "Drinks must not contain alcohol." }, "rejected"],
    [{ code: "BB003", message: "Published products require valid default option selections." }, "rejected"],
    [{ code: "23514", message: "check constraint" }, "rejected"],
    [{ code: "42501", message: "permission denied" }, "unauthorized"],
    [{ code: "XX000", message: "internal" }, "unavailable"]
  ])("maps %j to %s", async (error, code) => {
    const { client } = fakeClient(() => ({ error, status: 400 }));
    const result = await createSupabaseCatalogAdminRepository(client).createCategory(STORE, { name: "X", slug: "x", visible: true, kind: "burger", sortOrder: 10 });
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it("maps a thrown network failure to unavailable", async () => {
    const { client } = fakeClient(() => new TypeError("fetch failed"));
    expect(await createSupabaseCatalogAdminRepository(client).deleteProduct(STORE, ID)).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});

describe("product writes", () => {
  it("creates products unpublished, without alcohol, with exact cents", async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: ID } }));
    expect(await createSupabaseCatalogAdminRepository(client).createProduct(STORE, { ...fields, sortOrder: 30 })).toEqual({ ok: true, value: { id: ID } });
    expect(op(calls[0], "insert")[0]?.[1]).toEqual({
      store_id: STORE, category_id: ID, name: "Smash", slug: "smash", description: "Doble.", base_price_cents: 780000,
      is_available: true, is_featured: false, is_published: false, contains_alcohol: false, sort_order: 30
    });
  });

  it("only sends the publication flag and the order when asked to", async () => {
    const { client, calls } = fakeClient();
    const repository = createSupabaseCatalogAdminRepository(client);
    await repository.updateProduct(STORE, ID, fields);
    await repository.updateProduct(STORE, ID, { ...fields, published: false, sortOrder: 40 });
    const [first, second] = calls.map((call) => op(call, "update")[0]?.[1] as Record<string, unknown>);
    expect(first).not.toHaveProperty("is_published");
    expect(first).not.toHaveProperty("sort_order");
    expect(first).toMatchObject({ contains_alcohol: false });
    expect(second).toMatchObject({ is_published: false, sort_order: 40 });
  });

  it("refuses a price beyond JSON-safe integers without calling the database", async () => {
    const { client, calls } = fakeClient();
    const result = await createSupabaseCatalogAdminRepository(client).createProduct(STORE, { ...fields, priceCents: 2n ** 60n, sortOrder: 10 });
    expect(result).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(calls).toEqual([]);
  });
});

describe("replacing option links", () => {
  const OLD = [{ option_group_id: "g-old", default_option_ids: ["o-old"] }];
  const links = [{ groupId: "g1", defaultOptionIds: ["o1"] }, { groupId: "g2", defaultOptionIds: [] }];
  const stored = links.map((link) => ({ option_group_id: link.groupId, default_option_ids: link.defaultOptionIds }));

  /** Answers like PostgREST: the first select is the "before" read, the second the read-back. */
  function relinkClient(answers: { before?: unknown[]; deleted?: unknown[]; inserted?: Reply; after?: unknown[] }) {
    let selects = 0;
    return fakeClient((call) => {
      const first = call.ops[0]?.[0];
      if (first === "delete") return { data: answers.deleted ?? [] };
      if (first === "insert") return answers.inserted ?? { data: stored };
      selects += 1;
      return { data: selects === 1 ? (answers.before ?? []) : (answers.after ?? stored) };
    });
  }

  it("replaces the links inside the store: read, delete, insert in order, read back", async () => {
    const { client, calls } = relinkClient({ before: OLD, deleted: OLD });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, links)).toEqual({ ok: true, value: undefined });
    expect(calls.map((call) => call.ops[0]?.[0])).toEqual(["select", "delete", "insert", "select"]);
    for (const call of calls) {
      expect(call.table).toBe("product_option_groups");
      expect(op(call, "eq")).toEqual(call.ops[0]?.[0] === "insert" ? [] : [["eq", "store_id", STORE], ["eq", "product_id", ID]]);
    }
    expect(op(calls[2], "insert")[0]?.[1]).toEqual([
      { store_id: STORE, product_id: ID, option_group_id: "g1", default_option_ids: ["o1"], sort_order: 10 },
      { store_id: STORE, product_id: ID, option_group_id: "g2", default_option_ids: [], sort_order: 20 }
    ]);
    expect(op(calls[1], "select")).toEqual([["select", "option_group_id, default_option_ids"]]);
    expect(op(calls[2], "select")).toEqual([["select", "option_group_id, default_option_ids"]]);
  });

  it("fails when the delete removes nothing although links existed (filtered by RLS)", async () => {
    const { client, calls } = relinkClient({ before: OLD, deleted: [] });
    const result = await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, links);
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(calls.map((call) => call.ops[0]?.[0])).toEqual(["select", "delete"]);
  });

  it("fails when only part of the existing links is deleted", async () => {
    const before = [...OLD, { option_group_id: "g-other", default_option_ids: [] }];
    const { client } = relinkClient({ before, deleted: OLD });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, [])).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("accepts a product without previous links and without new ones", async () => {
    const { client, calls } = relinkClient({ before: [], deleted: [], after: [] });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, [])).toEqual({ ok: true, value: undefined });
    expect(calls.map((call) => call.ops[0]?.[0])).toEqual(["select", "delete", "select"]);
  });

  it("removes every link when the new set is empty, and checks nothing is left", async () => {
    const { client } = relinkClient({ before: OLD, deleted: OLD, after: OLD });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, [])).toMatchObject({ ok: false, error: { code: "unavailable" } });
    const clean = relinkClient({ before: OLD, deleted: OLD, after: [] });
    expect(await createSupabaseCatalogAdminRepository(clean.client).replaceOptionGroups(STORE, ID, [])).toEqual({ ok: true, value: undefined });
  });

  it("fails when the insert fails", async () => {
    const { client, calls } = relinkClient({ before: OLD, deleted: OLD, inserted: { error: { code: "23503", message: "fk" }, status: 409 } });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, links)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(calls).toHaveLength(3);
  });

  it("fails when the insert stores fewer links than requested", async () => {
    const { client } = relinkClient({ before: OLD, deleted: OLD, inserted: { data: stored.slice(0, 1) } });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, links)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("fails when the links read back are not the requested ones", async () => {
    const changedDefaults = [{ option_group_id: "g1", default_option_ids: ["o-other"] }, stored[1]];
    const { client } = relinkClient({ before: OLD, deleted: OLD, after: changedDefaults });
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, links)).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("fails when reading the current links fails, before deleting anything", async () => {
    const { client, calls } = fakeClient(() => ({ error: { code: "42501", message: "permission denied" }, status: 403 }));
    expect(await createSupabaseCatalogAdminRepository(client).replaceOptionGroups(STORE, ID, links)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(calls.map((call) => call.ops[0]?.[0])).toEqual(["select"]);
  });
});

describe("reads", () => {
  it("maps option group kinds to product types", async () => {
    const { client } = fakeClient(() => ({
      data: [{
        id: "g1", name: "Tamaño", selection_mode: "single", minimum_selections: 1, maximum_selections: 1, is_required: true, sort_order: 10,
        applicable_category_kinds: ["side", "drink"],
        options: [{ id: "o2", name: "Grande", price_delta_cents: "120000", is_available: true, sort_order: 20 }, { id: "o1", name: "Regular", price_delta_cents: "0", is_available: true, sort_order: 10 }]
      }]
    }));
    const result = await createSupabaseCatalogAdminRepository(client).listOptionGroups(STORE);
    expect(result).toMatchObject({ ok: true, value: [{ id: "g1", applicableTypes: ["fries", "beverage"], options: [{ id: "o1", priceDeltaCents: 0n }, { id: "o2", priceDeltaCents: 120000n }] }] });
  });

  it("reads the primary image through the product's store", async () => {
    const { client, calls } = fakeClient(() => ({
      data: [
        { id: "i2", storage_path: `${STORE}/b.webp`, alt_text: "B", focal_x: 50, focal_y: 50, is_primary: false, sort_order: 0 },
        { id: "i1", storage_path: `${STORE}/a.webp`, alt_text: "A", focal_x: 20, focal_y: 80, is_primary: true, sort_order: 5 }
      ]
    }));
    const result = await createSupabaseCatalogAdminRepository(client).getPrimaryImage(STORE, ID);
    expect(result).toEqual({ ok: true, value: { id: "i1", storagePath: `${STORE}/a.webp`, altText: "A", focalX: 20, focalY: 80 } });
    expect(op(calls[0], "eq")).toEqual([["eq", "product_id", ID], ["eq", "products.store_id", STORE]]);
  });
});

describe("storage", () => {
  it("uploads to the catalog bucket without overwriting", async () => {
    const { client, storage } = fakeClient();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await createSupabaseCatalogAdminRepository(client).putObject(`${STORE}/x.png`, bytes, "image/png")).toEqual({ ok: true, value: undefined });
    expect(client.storage.from).toHaveBeenCalledWith("catalog");
    expect(storage.upload).toHaveBeenCalledWith(`${STORE}/x.png`, bytes, { contentType: "image/png", upsert: false, cacheControl: "31536000" });
  });

  it.each([
    [{ statusCode: "409", message: "The resource already exists" }, "conflict"],
    [{ status: 403, message: "new row violates row-level security policy" }, "unauthorized"],
    [{ status: 415, message: "mime type image/svg+xml is not supported" }, "rejected"],
    [{ status: 503, message: "unavailable" }, "unavailable"]
  ])("maps the storage error %j to %s", async (error, code) => {
    const { client, storage } = fakeClient();
    storage.upload.mockResolvedValueOnce({ data: {}, error });
    expect(await createSupabaseCatalogAdminRepository(client).putObject(`${STORE}/x.png`, new Uint8Array(), "image/png")).toMatchObject({ ok: false, error: { code } });
  });
});
