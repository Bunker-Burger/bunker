import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PromotionWindow } from "@/domain/types";
import { err, ok } from "@/lib/result";
import { write, writeOne } from "@/server/admin/supabase-writes";
import type { AdminResult } from "@/server/admin/use-case";
import { parseRows } from "@/server/catalog/adapters";
import { catalogError } from "@/server/catalog/errors";
import type { QueryResponse } from "@/server/catalog/supabase-catalog-repository";
import type { Database } from "@/server/supabase/database.types";
import { PAYMENT_METHODS, STATUS_OVERRIDES, type PromotionFields, type PromotionItem, type StoreAdminRepository } from "./ports";

/*
 * Store and promotion writes through the signed-in admin's session client (RLS decides; no
 * service role). Every update/delete asks for the affected rows back; replacements of a
 * promotion's products and windows are verified step by step.
 */

const q = (query: unknown) => query as PromiseLike<QueryResponse>;

const storeRow = z.object({
  id: z.string(),
  timezone: z.string(),
  status_override: z.enum(STATUS_OVERRIDES),
  delivery_fee_cents: z.string().regex(/^\d+$/).nullable(),
  whatsapp_e164: z.string()
});
const shiftRow = z.object({ id: z.string(), day_of_week: z.number().int(), opens_at: z.string(), closes_at: z.string() });
const paymentRow = z.object({
  method: z.enum(PAYMENT_METHODS),
  display_name: z.string(),
  public_instructions: z.string(),
  is_enabled: z.boolean(),
  sort_order: z.number().int()
});
const promotionRow = z.object({ id: z.string(), priority: z.number().int(), is_active: z.boolean(), name: z.string() });
const itemRow = z.object({ product_id: z.string(), quantity: z.number().int() });
const windowRow = z.object({ day_of_week: z.number().int(), starts_at: z.string(), ends_at: z.string() });

const hhmm = (time: string) => time.slice(0, 5);

function safeCents(cents: bigint) {
  return Number.isSafeInteger(Number(cents)) ? Number(cents) : null;
}

/** Columns for one mechanic; the others are null, as the `promotion_rules_mechanic_check` requires. */
function mechanicColumns(fields: PromotionFields) {
  const none = { fixed_price_cents: null, percent_off: null, buy_quantity: null, get_quantity: null };
  const { mechanic } = fields;
  switch (mechanic.type) {
    case "percent_off":
      return { promotion_type: mechanic.type, ...none, percent_off: mechanic.percentOff };
    case "fixed_price":
      return { promotion_type: mechanic.type, ...none, fixed_price_cents: safeCents(mechanic.fixedPriceCents) };
    case "buy_x_get_y":
      return { promotion_type: mechanic.type, ...none, buy_quantity: mechanic.buyQuantity, get_quantity: mechanic.getQuantity };
    case "free_delivery":
      return { promotion_type: mechanic.type, ...none };
  }
}

function promotionColumns(fields: PromotionFields) {
  return {
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    badge_text: fields.badgeText,
    is_active: fields.active,
    starts_at: fields.startsAt.toISOString(),
    ends_at: fields.endsAt.toISOString(),
    applies_to_delivery: fields.channels.includes("delivery"),
    applies_to_pickup: fields.channels.includes("pickup"),
    ...mechanicColumns(fields)
  };
}

async function rows<S extends z.ZodType>(operation: string, table: string, schema: S, query: PromiseLike<QueryResponse>): Promise<AdminResult<Array<z.output<S>>>> {
  const response = await write(operation, query);
  if (!response.ok) return response;
  return parseRows(table, schema, response.value ?? []);
}

/**
 * Replace-and-verify: every row that was there must be deleted, every new row stored, and the
 * rows read back must be exactly the requested ones (compared by `key`).
 */
async function replaceVerified<T>(
  operation: string,
  steps: {
    read: () => Promise<AdminResult<T[]>>;
    remove: () => Promise<AdminResult<T[]>>;
    insert: () => Promise<AdminResult<T[]>>;
  },
  wanted: readonly T[],
  key: (row: T) => string
): Promise<AdminResult<void>> {
  const before = await steps.read();
  if (!before.ok) return before;
  const removed = await steps.remove();
  if (!removed.ok) return removed;
  const removedKeys = new Set(removed.value.map(key));
  if (before.value.some((row) => !removedKeys.has(key(row)))) {
    return catalogError("unauthorized", `${operation}: existing rows were not removed (RLS or concurrent change)`);
  }
  if (wanted.length > 0) {
    const inserted = await steps.insert();
    if (!inserted.ok) return inserted;
    if (inserted.value.length !== wanted.length) {
      return catalogError("unauthorized", `${operation}: stored ${inserted.value.length} of ${wanted.length} rows`);
    }
  }
  const after = await steps.read();
  if (!after.ok) return after;
  const same = JSON.stringify(after.value.map(key).sort()) === JSON.stringify(wanted.map(key).sort());
  return same ? ok(undefined) : catalogError("unavailable", `${operation}: rows read back differ from the requested ones`);
}

export function createSupabaseStoreAdminRepository(client: SupabaseClient<Database>): StoreAdminRepository {
  async function promotionInStore(storeId: string, promotionId: string): Promise<AdminResult<void>> {
    const found = await rows("promotion_rules.select", "promotion_rules", promotionRow, q(client.from("promotion_rules").select("id, priority, is_active, name").eq("store_id", storeId).eq("id", promotionId)));
    if (!found.ok) return found;
    return found.value.length === 1 ? ok(undefined) : catalogError("not_found", "promotion_rules: no promotion in this store");
  }

  return {
    async getStore(storeId) {
      const found = await rows(
        "stores.select",
        "stores",
        storeRow,
        q(client.from("stores").select("id, timezone, status_override, delivery_fee_cents:delivery_fee_cents::text, whatsapp_e164").eq("id", storeId))
      );
      if (!found.ok) return found;
      const [row] = found.value;
      return ok(
        row
          ? {
              id: row.id,
              timezone: row.timezone,
              statusOverride: row.status_override,
              deliveryFeeCents: row.delivery_fee_cents === null ? null : BigInt(row.delivery_fee_cents),
              whatsappE164: row.whatsapp_e164
            }
          : null
      );
    },

    setStatusOverride(storeId, statusOverride) {
      return writeOne("stores.update", q(client.from("stores").update({ status_override: statusOverride }).eq("id", storeId).select("id")));
    },

    async setContact(storeId, fields) {
      const fee = fields.deliveryFeeCents === null ? null : safeCents(fields.deliveryFeeCents);
      if (fields.deliveryFeeCents !== null && fee === null) return err({ code: "rejected", message: "stores.update: fee out of range" });
      return writeOne(
        "stores.update",
        q(client.from("stores").update({ delivery_fee_cents: fee, whatsapp_e164: fields.whatsappE164 }).eq("id", storeId).select("id"))
      );
    },

    async listShifts(storeId) {
      const found = await rows(
        "store_business_hours.select",
        "store_business_hours",
        shiftRow,
        q(client.from("store_business_hours").select("id, day_of_week, opens_at, closes_at").eq("store_id", storeId))
      );
      if (!found.ok) return found;
      return ok(
        found.value
          .map((row) => ({ id: row.id, dayOfWeek: row.day_of_week, opensAt: hhmm(row.opens_at), closesAt: hhmm(row.closes_at) }))
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt))
      );
    },

    addShift(storeId, shift) {
      return writeOne(
        "store_business_hours.insert",
        q(
          client
            .from("store_business_hours")
            .insert({ store_id: storeId, day_of_week: shift.dayOfWeek, opens_at: shift.opensAt, closes_at: shift.closesAt })
            .select("id")
        )
      );
    },

    deleteShift(storeId, shiftId) {
      return writeOne("store_business_hours.delete", q(client.from("store_business_hours").delete().eq("store_id", storeId).eq("id", shiftId).select("id")));
    },

    async listPaymentMethods(storeId) {
      const found = await rows(
        "store_payment_methods.select",
        "store_payment_methods",
        paymentRow,
        q(client.from("store_payment_methods").select("method, display_name, public_instructions, is_enabled, sort_order").eq("store_id", storeId))
      );
      if (!found.ok) return found;
      return ok(
        found.value
          .map((row) => ({ method: row.method, displayName: row.display_name, instructions: row.public_instructions, enabled: row.is_enabled, sortOrder: row.sort_order }))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.method.localeCompare(b.method))
      );
    },

    savePaymentMethod(storeId, method) {
      return writeOne(
        "store_payment_methods.upsert",
        q(
          client
            .from("store_payment_methods")
            .upsert(
              {
                store_id: storeId,
                method: method.method,
                display_name: method.displayName,
                public_instructions: method.instructions,
                is_enabled: method.enabled,
                sort_order: method.sortOrder
              },
              { onConflict: "store_id,method" }
            )
            .select("id")
        )
      );
    },

    async listPromotions(storeId) {
      const found = await rows("promotion_rules.select", "promotion_rules", promotionRow, q(client.from("promotion_rules").select("id, priority, is_active, name").eq("store_id", storeId)));
      return found.ok ? ok(found.value.map((row) => ({ id: row.id, priority: row.priority, active: row.is_active, name: row.name }))) : found;
    },

    async listProductIds(storeId) {
      const found = await rows("products.select", "products", z.object({ id: z.string() }), q(client.from("products").select("id").eq("store_id", storeId)));
      return found.ok ? ok(found.value.map((row) => row.id)) : found;
    },

    async createPromotion(storeId, fields) {
      const columns = promotionColumns(fields);
      if (fields.mechanic.type === "fixed_price" && columns.fixed_price_cents === null) {
        return err({ code: "rejected", message: "promotion_rules.insert: price out of range" });
      }
      const created = await write(
        "promotion_rules.insert",
        q(client.from("promotion_rules").insert({ store_id: storeId, priority: fields.priority, ...columns }).select("id").single())
      );
      if (!created.ok) return created;
      const id = (created.value as { id?: unknown } | null)?.id;
      return typeof id === "string" ? ok({ id }) : catalogError("invalid_data", "promotion_rules.insert: no id returned");
    },

    async updatePromotion(storeId, promotionId, fields) {
      const columns = promotionColumns(fields);
      if (fields.mechanic.type === "fixed_price" && columns.fixed_price_cents === null) {
        return err({ code: "rejected", message: "promotion_rules.update: price out of range" });
      }
      return writeOne("promotion_rules.update", q(client.from("promotion_rules").update(columns).eq("store_id", storeId).eq("id", promotionId).select("id")));
    },

    setPromotionActive(storeId, promotionId, active) {
      return writeOne("promotion_rules.update", q(client.from("promotion_rules").update({ is_active: active }).eq("store_id", storeId).eq("id", promotionId).select("id")));
    },

    setPromotionPriority(storeId, promotionId, priority) {
      return writeOne("promotion_rules.update", q(client.from("promotion_rules").update({ priority }).eq("store_id", storeId).eq("id", promotionId).select("id")));
    },

    deletePromotion(storeId, promotionId) {
      return writeOne("promotion_rules.delete", q(client.from("promotion_rules").delete().eq("store_id", storeId).eq("id", promotionId).select("id")));
    },

    async replacePromotionItems(storeId, promotionId, items) {
      const toItems = (found: AdminResult<Array<z.output<typeof itemRow>>>): AdminResult<PromotionItem[]> =>
        found.ok ? ok(found.value.map((row) => ({ productId: row.product_id, quantity: row.quantity }))) : found;
      return replaceVerified(
        "promotion_items",
        {
          read: async () =>
            toItems(await rows("promotion_items.select", "promotion_items", itemRow, q(client.from("promotion_items").select("product_id, quantity").eq("store_id", storeId).eq("promotion_id", promotionId)))),
          remove: async () =>
            toItems(
              await rows("promotion_items.delete", "promotion_items", itemRow, q(client.from("promotion_items").delete().eq("store_id", storeId).eq("promotion_id", promotionId).select("product_id, quantity")))
            ),
          insert: async () =>
            toItems(
              await rows(
                "promotion_items.insert",
                "promotion_items",
                itemRow,
                q(
                  client
                    .from("promotion_items")
                    .insert(items.map((item) => ({ store_id: storeId, promotion_id: promotionId, product_id: item.productId, quantity: item.quantity })))
                    .select("product_id, quantity")
                )
              )
            )
        },
        items,
        (item) => `${item.productId}×${item.quantity}`
      );
    },

    async replacePromotionSchedule(storeId, promotionId, windows) {
      // promotion_schedule has no store_id: confirm the promotion is this store's first.
      const owned = await promotionInStore(storeId, promotionId);
      if (!owned.ok) return owned;
      const toWindows = (found: AdminResult<Array<z.output<typeof windowRow>>>): AdminResult<PromotionWindow[]> =>
        found.ok ? ok(found.value.map((row) => ({ dayOfWeek: row.day_of_week, startsAt: hhmm(row.starts_at), endsAt: hhmm(row.ends_at) }))) : found;
      return replaceVerified(
        "promotion_schedule",
        {
          read: async () =>
            toWindows(await rows("promotion_schedule.select", "promotion_schedule", windowRow, q(client.from("promotion_schedule").select("day_of_week, starts_at, ends_at").eq("promotion_id", promotionId)))),
          remove: async () =>
            toWindows(
              await rows("promotion_schedule.delete", "promotion_schedule", windowRow, q(client.from("promotion_schedule").delete().eq("promotion_id", promotionId).select("day_of_week, starts_at, ends_at")))
            ),
          insert: async () =>
            toWindows(
              await rows(
                "promotion_schedule.insert",
                "promotion_schedule",
                windowRow,
                q(
                  client
                    .from("promotion_schedule")
                    .insert(windows.map((window) => ({ promotion_id: promotionId, day_of_week: window.dayOfWeek, starts_at: window.startsAt, ends_at: window.endsAt })))
                    .select("day_of_week, starts_at, ends_at")
                )
              )
            )
        },
        windows,
        (window) => `${window.dayOfWeek}@${hhmm(window.startsAt)}-${hhmm(window.endsAt)}`
      );
    }
  };
}
