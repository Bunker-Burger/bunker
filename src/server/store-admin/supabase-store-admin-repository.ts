import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PAYMENT_METHOD_NAME } from "@/domain/public-payment-options";
import { err, ok } from "@/lib/result";
import { write, writeOne } from "@/server/admin/supabase-writes";
import type { AdminResult } from "@/server/admin/use-case";
import { parseRows } from "@/server/catalog/adapters";
import { catalogError } from "@/server/catalog/errors";
import type { QueryResponse } from "@/server/catalog/supabase-catalog-repository";
import type { Database } from "@/server/supabase/database.types";
import { STATUS_OVERRIDES, type PromotionFields, type StoreAdminRepository } from "./ports";

/*
 * Store and promotion writes through the signed-in admin's session client (RLS decides; no
 * service role). Every update/delete asks for the affected rows back. Saving and reordering a
 * promotion touch several rows, so each is one call to a SECURITY INVOKER function
 * (admin_save_promotion, admin_move_promotion) that runs in a single transaction.
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

const hhmm = (time: string) => time.slice(0, 5);

function safeCents(cents: bigint) {
  return Number.isSafeInteger(Number(cents)) ? Number(cents) : null;
}

/**
 * Columns for one mechanic; the others are null, as the `promotion_rules_mechanic_check` requires.
 * The fixed price travels as text so the function casts it to bigint without losing cents.
 */
function mechanicColumns(fields: PromotionFields) {
  const none = { fixed_price_cents: null, percent_off: null, buy_quantity: null, get_quantity: null };
  const { mechanic } = fields;
  switch (mechanic.type) {
    case "percent_off":
      return { promotion_type: mechanic.type, ...none, percent_off: mechanic.percentOff };
    case "fixed_price":
      return { promotion_type: mechanic.type, ...none, fixed_price_cents: mechanic.fixedPriceCents.toString() };
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

export function createSupabaseStoreAdminRepository(client: SupabaseClient<Database>): StoreAdminRepository {
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
                // Fixed copy: the row is public once enabled (store_payment_methods_fixed_public_copy).
                display_name: PAYMENT_METHOD_NAME[method.method],
                public_instructions: "",
                is_enabled: method.enabled,
                sort_order: method.sortOrder
              },
              { onConflict: "store_id,method" }
            )
            .select("id")
        )
      );
    },

    async listProductIds(storeId) {
      const found = await rows("products.select", "products", z.object({ id: z.string() }), q(client.from("products").select("id").eq("store_id", storeId)));
      return found.ok ? ok(found.value.map((row) => row.id)) : found;
    },

    async savePromotion(storeId, promotionId, { fields, items, schedule }) {
      const saved = await write(
        "admin_save_promotion",
        q(
          client.rpc("admin_save_promotion", {
            target_store_id: storeId,
            // null creates; the generated type cannot express a nullable argument.
            target_promotion_id: promotionId as string,
            promotion: promotionColumns(fields),
            items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
            schedule: schedule.map((window) => ({ day_of_week: window.dayOfWeek, starts_at: window.startsAt, ends_at: window.endsAt }))
          })
        )
      );
      if (!saved.ok) return saved;
      return typeof saved.value === "string" ? ok({ id: saved.value }) : catalogError("invalid_data", "admin_save_promotion: no id returned");
    },

    setPromotionActive(storeId, promotionId, active) {
      return writeOne("promotion_rules.update", q(client.from("promotion_rules").update({ is_active: active }).eq("store_id", storeId).eq("id", promotionId).select("id")));
    },

    async movePromotion(storeId, promotionId, direction) {
      const moved = await write(
        "admin_move_promotion",
        q(client.rpc("admin_move_promotion", { target_store_id: storeId, target_promotion_id: promotionId, direction }))
      );
      if (!moved.ok) return moved;
      return typeof moved.value === "boolean" ? ok({ moved: moved.value }) : catalogError("invalid_data", "admin_move_promotion: no result");
    },

    async listPromotionOrder(storeId) {
      const found = await rows(
        "promotion_rules.select",
        "promotion_rules",
        z.object({ id: z.string() }),
        q(client.from("promotion_rules").select("id").eq("store_id", storeId).order("priority", { ascending: false }).order("id"))
      );
      return found.ok ? ok(found.value.map((row) => row.id)) : found;
    },

    deletePromotion(storeId, promotionId) {
      return writeOne("promotion_rules.delete", q(client.from("promotion_rules").delete().eq("store_id", storeId).eq("id", promotionId).select("id")));
    }
  };
}
