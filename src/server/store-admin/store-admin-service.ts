import { findOverlappingShift } from "@/domain/store-admin";
import { adminUseCases, type AdminUseCaseDependencies } from "@/server/admin/use-case";
import { parseDirection, parseId } from "@/server/catalog-admin/input";
import { parseContact, parsePaymentMethod, parsePromotionForm, parseShift, parseStatusOverride } from "./input";
import type { StoreAdminRepository, StoredPromotion } from "./ports";

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

const { success, invalid, failure, asAdmin } = adminUseCases("store-admin");

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
    if (!saved.ok) return failure(deps, "setStoreStatus", saved.error, { rejected: FEE_REQUIRED });
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
    if (!saved.ok) return failure(deps, "saveStoreContact", saved.error, { rejected: "La base rechazó la tarifa o el teléfono." });
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
    if (!saved.ok) return failure(deps, "addShift", saved.error, { conflict: "Ya hay un turno que empieza a esa hora ese día." });
    return success(`Turno del ${WEEKDAYS[shift.value.dayOfWeek]} agregado.`, undefined);
  });
}

export function deleteShift(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "deleteShift", async (storeId) => {
    const id = parseId(form, "shiftId");
    if (!id.ok) return invalid(id.error);
    const deleted = await deps.repository.deleteShift(storeId, id.value);
    if (!deleted.ok) return failure(deps, "deleteShift", deleted.error);
    return success("Turno eliminado.", undefined);
  });
}

export function savePaymentMethod(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "savePaymentMethod", async (storeId) => {
    const method = parsePaymentMethod(form);
    if (!method.ok) return invalid(method.error);
    const saved = await deps.repository.savePaymentMethod(storeId, method.value);
    if (!saved.ok) return failure(deps, "savePaymentMethod", saved.error);
    if (method.value.method === "mercado_pago" && method.value.enabled && !deps.mercadoPagoConfigured()) {
      return success("Guardado. Mercado Pago no se ofrece a los clientes hasta completar su configuración en el servidor.", undefined);
    }
    return success(`${method.value.displayName}: ${method.value.enabled ? "habilitado" : "deshabilitado"}.`, undefined);
  });
}

// ---------------------------------------------------------------------------------------------
// Promotions

/**
 * Creates or updates a promotion with its products and weekly windows. While they are replaced
 * the promotion is paused, so a quote never applies a half-written rule; it is activated last,
 * only if requested and everything was stored.
 */
export function savePromotion(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin<{ promotionId: string }>(deps, "savePromotion", async (storeId) => {
    const existingId = form.get("promotionId") ? parseId(form, "promotionId") : null;
    if (existingId && !existingId.ok) return invalid(existingId.error);
    const loaded = await loadStore(deps, "savePromotion", storeId);
    if (!loaded.store) return loaded.outcome;
    const parsed = parsePromotionForm(form, loaded.store.timezone);
    if (!parsed.ok) return invalid(parsed.error);
    const { fields, items, schedule } = parsed.value;

    const productIds = await deps.repository.listProductIds(storeId);
    if (!productIds.ok) return failure(deps, "savePromotion", productIds.error);
    const known = new Set(productIds.value);
    if (items.some((item) => !known.has(item.productId))) return invalid({ items: "Un producto ya no existe. Recargá la página." });

    const conflict = { conflict: "Ya existe una promoción con ese slug." };
    const draft = { ...fields, active: false };
    let promotionId: string;
    if (existingId) {
      promotionId = existingId.value;
      const updated = await deps.repository.updatePromotion(storeId, promotionId, draft);
      if (!updated.ok) return failure(deps, "savePromotion", updated.error, conflict);
    } else {
      const promotions = await deps.repository.listPromotions(storeId);
      if (!promotions.ok) return failure(deps, "savePromotion", promotions.error);
      const priority = promotions.value.reduce((max, promotion) => Math.max(max, promotion.priority), 0) + 1;
      if (priority > 32_767) return { ok: false, message: "No hay más prioridades disponibles: eliminá promociones viejas." };
      const created = await deps.repository.createPromotion(storeId, { ...draft, priority });
      if (!created.ok) return failure(deps, "savePromotion", created.error, conflict);
      promotionId = created.value.id;
    }

    const paused = (outcome: { message: string }) => ({ ok: false as const, message: `La promoción quedó pausada: ${outcome.message}` });
    const savedItems = await deps.repository.replacePromotionItems(storeId, promotionId, items);
    if (!savedItems.ok) return paused(failure(deps, "savePromotion", savedItems.error));
    const savedSchedule = await deps.repository.replacePromotionSchedule(storeId, promotionId, schedule);
    if (!savedSchedule.ok) return paused(failure(deps, "savePromotion", savedSchedule.error));
    if (fields.active) {
      const activated = await deps.repository.setPromotionActive(storeId, promotionId, true);
      if (!activated.ok) return paused(failure(deps, "savePromotion", activated.error));
    }
    return success(fields.active ? `“${fields.name}” guardada y activa.` : `“${fields.name}” guardada en pausa.`, { promotionId });
  });
}

export function setPromotionActive(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "setPromotionActive", async (storeId) => {
    const id = parseId(form, "promotionId");
    if (!id.ok) return invalid(id.error);
    const active = form.get("active") === "true";
    const saved = await deps.repository.setPromotionActive(storeId, id.value, active);
    if (!saved.ok) return failure(deps, "setPromotionActive", saved.error);
    return success(active ? "Promoción reanudada." : "Promoción pausada.", undefined);
  });
}

const byPriorityDesc = (a: StoredPromotion, b: StoredPromotion) => b.priority - a.priority || a.id.localeCompare(b.id);

/**
 * "Up" means it applies before the next one (higher priority). Priorities are unique per store,
 * so the swap goes through a free value above all of them.
 */
export function movePromotion(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "movePromotion", async (storeId) => {
    const id = parseId(form, "promotionId");
    if (!id.ok) return invalid(id.error);
    const direction = parseDirection(form);
    if (!direction.ok) return invalid(direction.error);
    const promotions = await deps.repository.listPromotions(storeId);
    if (!promotions.ok) return failure(deps, "movePromotion", promotions.error);
    const ordered = [...promotions.value].sort(byPriorityDesc);
    const index = ordered.findIndex((promotion) => promotion.id === id.value);
    if (index < 0) return failure(deps, "movePromotion", { code: "not_found", message: "promotion not in store" });
    const neighbour = ordered[direction.value === "up" ? index - 1 : index + 1];
    if (!neighbour) return success("La promoción ya está en ese extremo.", undefined);
    const current = ordered[index]!;
    const free = Math.max(...ordered.map((promotion) => promotion.priority)) + 1;
    if (free > 32_767) return { ok: false, message: "No hay más prioridades disponibles: eliminá promociones viejas." };

    for (const [promotionId, priority] of [[current.id, free], [neighbour.id, current.priority], [current.id, neighbour.priority]] as const) {
      const saved = await deps.repository.setPromotionPriority(storeId, promotionId, priority);
      if (!saved.ok) return failure(deps, "movePromotion", saved.error);
    }
    return success("Orden de promociones actualizado.", undefined);
  });
}

export function deletePromotion(deps: StoreAdminDependencies, form: FormData) {
  return asAdmin(deps, "deletePromotion", async (storeId) => {
    const id = parseId(form, "promotionId");
    if (!id.ok) return invalid(id.error);
    const deleted = await deps.repository.deletePromotion(storeId, id.value);
    if (!deleted.ok) return failure(deps, "deletePromotion", deleted.error);
    return success("Promoción eliminada.", undefined);
  });
}
