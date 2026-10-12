import { PAYMENT_METHOD_NAME } from "@/domain/public-payment-options";
import { findOverlappingShift } from "@/domain/store-admin";
import { adminUseCases, type AdminUseCaseDependencies } from "@/server/admin/use-case";
import { parseDirection, parseId } from "@/server/catalog-admin/input";
import { parseContact, parsePaymentMethod, parsePromotionForm, parseShift, parseStatusOverride } from "./input";
import type { StoreAdminRepository } from "./ports";

/*
 * Store operation and promotion use cases. Same contract as the catalog admin: the gate decides
 * who administers the store and gives its id; RLS re-checks every write; the browser never picks
 * the store. Secrets (Mercado Pago, Supabase) are never read or returned here: Mercado Pago's
 * server configuration only reaches this module as a boolean.
 */

export type { AdminOutcome } from "@/server/admin/use-case";

export interface StoreAdminDependencies extends AdminUseCaseDependencies {
  repository: StoreAdminRepository;
  /** Whether the server has a usable Mercado Pago configuration; never the credentials. */
  mercadoPagoConfigured: () => boolean;
}

const { success, invalid, failure, writeFailure, asAdmin } = adminUseCases("store-admin");

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const FEE_REQUIRED = "Configurá la tarifa de delivery antes de habilitar pedidos.";

async function loadStore(deps: StoreAdminDependencies, operation: string, storeId: string) {
  const store = await deps.repository.getStore(storeId);
  if (!store.ok) return { outcome: failure(deps, operation, store.error) };
  if (!store.value) return { outcome: failure(deps, operation, { code: "not_found", message: "store row not readable" }) };
  return { store: store.value };
}

// ---------------------------------------------------------------------------------------------
// Store status, contact and hours

/** `auto` and `open` take orders, so they require a configured delivery fee (also a DB check). */
export function setStoreStatus(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "setStoreStatus", async (storeId) => {
    const override = parseStatusOverride(form);
    if (!override.ok) return invalid(override.error);
    const loaded = await loadStore(deps, "setStoreStatus", storeId);
    if (!loaded.store) return loaded.outcome;
    if ((override.value === "auto" || override.value === "open") && loaded.store.deliveryFeeCents === null) {
      return invalid({ statusOverride: FEE_REQUIRED });
    }
    const saved = await deps.repository.setStatusOverride(storeId, override.value);
    if (!saved.ok) return writeFailure(deps, "setStoreStatus", saved.error, { rejected: FEE_REQUIRED });
    const messages = {
      auto: "El local sigue los horarios.",
      open: "El local quedó abierto manualmente.",
      paused: "Pedidos en pausa.",
      closed: "El local quedó cerrado."
    } as const;
    return success(messages[override.value], undefined);
  });
}

export function saveStoreContact(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "saveStoreContact", async (storeId) => {
    const contact = parseContact(form);
    if (!contact.ok) return invalid(contact.error);
    const loaded = await loadStore(deps, "saveStoreContact", storeId);
    if (!loaded.store) return loaded.outcome;
    const takingOrders = loaded.store.statusOverride === "auto" || loaded.store.statusOverride === "open";
    if (contact.value.deliveryFeeCents === null && takingOrders) {
      return invalid({ deliveryFee: "Sin tarifa no se pueden tomar pedidos: pausá o cerrá el local antes de quitarla." });
    }
    const saved = await deps.repository.setContact(storeId, contact.value);
    if (!saved.ok) return writeFailure(deps, "saveStoreContact", saved.error, { rejected: "La base rechazó la tarifa o el teléfono." });
    return success("Tarifa y WhatsApp guardados.", undefined);
  });
}

export function addShift(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "addShift", async (storeId) => {
    const shift = parseShift(form);
    if (!shift.ok) return invalid(shift.error);
    const shifts = await deps.repository.listShifts(storeId);
    if (!shifts.ok) return failure(deps, "addShift", shifts.error);
    const clash = findOverlappingShift(shifts.value, shift.value);
    if (clash) {
      return invalid({ opensAt: `Se superpone con el turno del ${WEEKDAYS[clash.dayOfWeek]} de ${clash.opensAt.slice(0, 5)} a ${clash.closesAt.slice(0, 5)}.` });
    }
    const saved = await deps.repository.addShift(storeId, shift.value);
    if (!saved.ok) return writeFailure(deps, "addShift", saved.error, { conflict: "Ya hay un turno que empieza a esa hora ese día." });
    return success(`Turno del ${WEEKDAYS[shift.value.dayOfWeek]} agregado.`, undefined);
  });
}

export function deleteShift(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "deleteShift", async (storeId) => {
    const id = parseId(form, "shiftId");
    if (!id.ok) return invalid(id.error);
    const deleted = await deps.repository.deleteShift(storeId, id.value);
    if (!deleted.ok) return writeFailure(deps, "deleteShift", deleted.error);
    return success("Turno eliminado.", undefined);
  });
}

export function savePaymentMethod(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "savePaymentMethod", async (storeId) => {
    const method = parsePaymentMethod(form);
    if (!method.ok) return invalid(method.error);
    const saved = await deps.repository.savePaymentMethod(storeId, method.value);
    if (!saved.ok) return writeFailure(deps, "savePaymentMethod", saved.error);
    if (method.value.method === "mercado_pago" && method.value.enabled && !deps.mercadoPagoConfigured()) {
      return success("Guardado. Mercado Pago no se ofrece a los clientes hasta completar su configuración en el servidor.", undefined);
    }
    return success(`${PAYMENT_METHOD_NAME[method.value.method]}: ${method.value.enabled ? "habilitado" : "deshabilitado"}.`, undefined);
  });
}

// ---------------------------------------------------------------------------------------------
// Promotions

/**
 * Creates or updates a promotion with its products and weekly windows in one transaction: a
 * failure leaves the promotion exactly as it was (no pause, no half-replaced products), so the
 * menu and the quote keep reading the same rule.
 */
export function savePromotion(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin<{ promotionId: string }>(deps, "savePromotion", async (storeId) => {
    const existingId = form.get("promotionId") ? parseId(form, "promotionId") : null;
    if (existingId && !existingId.ok) return invalid(existingId.error);
    const loaded = await loadStore(deps, "savePromotion", storeId);
    if (!loaded.store) return loaded.outcome;
    const parsed = parsePromotionForm(form, loaded.store.timezone);
    if (!parsed.ok) return invalid(parsed.error);
    const { fields, items } = parsed.value;

    const productIds = await deps.repository.listProductIds(storeId);
    if (!productIds.ok) return failure(deps, "savePromotion", productIds.error);
    const known = new Set(productIds.value);
    if (items.some((item) => !known.has(item.productId))) return invalid({ items: "Un producto ya no existe. Recargá la página." });

    const saved = await deps.repository.savePromotion(storeId, existingId ? existingId.value : null, parsed.value);
    if (!saved.ok) {
      return writeFailure(deps, "savePromotion", saved.error, {
        conflict: "Ya existe una promoción con ese slug.",
        rejected: "La base de datos rechazó la promoción (o no quedan prioridades libres). No se guardó nada."
      });
    }
    return success(fields.active ? `“${fields.name}” guardada y activa.` : `“${fields.name}” guardada en pausa.`, { promotionId: saved.value.id });
  });
}

export function setPromotionActive(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "setPromotionActive", async (storeId) => {
    const id = parseId(form, "promotionId");
    if (!id.ok) return invalid(id.error);
    const active = form.get("active") === "true";
    const saved = await deps.repository.setPromotionActive(storeId, id.value, active);
    if (!saved.ok) return writeFailure(deps, "setPromotionActive", saved.error);
    return success(active ? "Promoción reanudada." : "Promoción pausada.", undefined);
  });
}

/** "Up" means it applies before the next one (higher priority). The swap is one transaction. */
export function movePromotion(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "movePromotion", async (storeId) => {
    const id = parseId(form, "promotionId");
    if (!id.ok) return invalid(id.error);
    const direction = parseDirection(form);
    if (!direction.ok) return invalid(direction.error);
    const moved = await deps.repository.movePromotion(storeId, id.value, direction.value);
    if (!moved.ok) return writeFailure(deps, "movePromotion", moved.error, { rejected: "No hay más prioridades disponibles: eliminá promociones viejas." });
    return success(moved.value.moved ? "Orden de promociones actualizado." : "La promoción ya está en ese extremo.", undefined);
  });
}

/**
 * Puts the promotions in the dragged order (first = tried first, issue #54). Priorities only
 * change by swapping neighbours in the database, so the new order is reached one swap at a time.
 */
export function reorderPromotions(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "reorderPromotions", async (storeId) => {
    const wanted = form.getAll("promotionId").map((value) => (typeof value === "string" ? value.toLowerCase() : ""));
    const listed = await deps.repository.listPromotionOrder(storeId);
    if (!listed.ok) return writeFailure(deps, "reorderPromotions", listed.error);
    const current = [...listed.value];
    const known = new Set(current);
    if (wanted.length !== known.size || new Set(wanted).size !== wanted.length || !wanted.every((id) => known.has(id))) {
      return invalid({ promotionId: "Las promociones cambiaron mientras las ordenabas. Recargá la página." });
    }
    for (const [target, id] of wanted.entries()) {
      for (let at = current.indexOf(id); at > target; at -= 1) {
        const moved = await deps.repository.movePromotion(storeId, id, "up");
        if (!moved.ok) return writeFailure(deps, "reorderPromotions", moved.error, { rejected: "No hay más prioridades disponibles: eliminá promociones viejas." });
        [current[at - 1], current[at]] = [current[at]!, current[at - 1]!];
      }
    }
    return success("Orden de promociones guardado.", undefined);
  });
}

export function deletePromotion(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "deletePromotion", async (storeId) => {
    const id = parseId(form, "promotionId");
    if (!id.ok) return invalid(id.error);
    const deleted = await deps.repository.deletePromotion(storeId, id.value);
    if (!deleted.ok) return writeFailure(deps, "deletePromotion", deleted.error);
    return success("Promoción eliminada.", undefined);
  });
}
