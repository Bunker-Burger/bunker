import { instantFromLocalInput } from "@/domain/store-admin";
import type { FulfilmentMethod, PromotionMechanic, PromotionWindow } from "@/domain/types";
import { err, ok, type Result } from "@/lib/result";
import type { FieldErrors } from "@/server/admin/use-case";
import { parsePriceCents, slugify } from "@/server/catalog-admin/input";
import {
  PAYMENT_METHODS,
  STATUS_OVERRIDES,
  type PromotionDraft,
  type PromotionItem,
  type StoreContactFields,
  type StoredPaymentMethod,
  type StoredShift
} from "./ports";

/* Parses the store and promotion admin forms; nothing from the browser is trusted. */

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");
const texts = (form: FormData, name: string) => form.getAll(name).map(text);
const checked = (value: FormDataEntryValue | null) => value === "on" || value === "true";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export function parseStatusOverride(form: FormData) {
  const value = text(form.get("statusOverride"));
  return (STATUS_OVERRIDES as readonly string[]).includes(value)
    ? ok(value as (typeof STATUS_OVERRIDES)[number])
    : err<FieldErrors>({ statusOverride: "Elegí un estado." });
}

/** "+54 9 381 555-1234" → "+5493815551234". */
export function normalizeWhatsapp(raw: string) {
  return raw.replace(/[\s().-]/g, "");
}

export function parseContact(form: FormData): Result<StoreContactFields, FieldErrors> {
  const errors: FieldErrors = {};
  const feeText = text(form.get("deliveryFee")).trim();
  const deliveryFeeCents = feeText === "" ? null : parsePriceCents(feeText);
  if (feeText !== "" && deliveryFeeCents === null) errors.deliveryFee = "Ingresá la tarifa en pesos, por ejemplo 1200 o 1200.50.";
  const whatsappE164 = normalizeWhatsapp(text(form.get("whatsapp")));
  if (!E164.test(whatsappE164)) errors.whatsapp = "Ingresá el número con código de país, por ejemplo +5493815551234.";
  return Object.keys(errors).length > 0 ? err(errors) : ok({ deliveryFeeCents, whatsappE164 });
}

export function parseShift(form: FormData): Result<Omit<StoredShift, "id">, FieldErrors> {
  const errors: FieldErrors = {};
  const day = Number(text(form.get("dayOfWeek")));
  if (!Number.isInteger(day) || day < 0 || day > 6 || text(form.get("dayOfWeek")) === "") errors.dayOfWeek = "Elegí un día.";
  const opensAt = text(form.get("opensAt"));
  const closesAt = text(form.get("closesAt"));
  if (!TIME.test(opensAt)) errors.opensAt = "Hora inválida (HH:MM).";
  if (!TIME.test(closesAt)) errors.closesAt = "Hora inválida (HH:MM).";
  if (!errors.opensAt && !errors.closesAt && opensAt === closesAt) errors.closesAt = "El cierre tiene que ser distinto de la apertura.";
  return Object.keys(errors).length > 0 ? err(errors) : ok({ dayOfWeek: day, opensAt, closesAt });
}

/*
 * Payment instructions are stored in a publicly readable column, and a transfer must never show
 * an alias or bank details (the customer asks for them on WhatsApp). This refuses what looks like
 * them; neutral copy such as "Pedí el alias por WhatsApp" is fine.
 */
const BANK_DETAILS = [
  // "Alias: bunker.burger", "CBU = 0000…", "CVU: …"
  /\b(?:alias|cbu|cvu)\s*[:=]/i,
  // "alias bunker.burger.mp", "el alias es bunker-burger", "CBU 285059…"
  /\b(?:alias|cbu|cvu)\s+(?:es\s+)?["“'«]?[a-z0-9ñ]*[.\-\d][a-z0-9ñ.\-]*/i,
  // An alias on its own: words joined by dots ("bunker.burger.mp").
  /[a-z0-9ñ-]+\.[a-z0-9ñ-]+\.[a-z0-9ñ-]+/i,
  // CBU/CVU (22 digits), account numbers, CUIT: 11 or more digits, spaces or dashes in between.
  /\d(?:[\s.\-/]*\d){10,}/
];

export function containsBankDetails(text: string) {
  return BANK_DETAILS.some((pattern) => pattern.test(text));
}

export function parsePaymentMethod(form: FormData): Result<StoredPaymentMethod, FieldErrors> {
  const errors: FieldErrors = {};
  const method = text(form.get("method"));
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) errors.method = "Medio de pago inválido.";
  const displayName = text(form.get("displayName")).trim();
  if (displayName.length < 1 || displayName.length > 60) errors.displayName = "Ingresá un nombre de hasta 60 caracteres.";
  const instructions = text(form.get("instructions")).trim();
  if (instructions.length > 500) errors.instructions = "Máximo 500 caracteres.";
  else if (containsBankDetails(instructions)) {
    errors.instructions = "No escribas alias, CBU, CVU ni números de cuenta: el cliente los pide por WhatsApp.";
  }
  const sortOrder = Number(text(form.get("sortOrder")) || "0");
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) errors.sortOrder = "Orden entre 0 y 1000.";
  if (Object.keys(errors).length > 0) return err(errors);
  return ok({ method: method as StoredPaymentMethod["method"], displayName, instructions, enabled: checked(form.get("enabled")), sortOrder });
}

const PERCENT = /^\d{1,3}(?:\.\d{1,2})?$/;

function parseMechanic(form: FormData, errors: FieldErrors): PromotionMechanic | null {
  const type = text(form.get("type"));
  switch (type) {
    case "percent_off": {
      const raw = text(form.get("percentOff")).trim();
      const value = Number(raw);
      if (!PERCENT.test(raw) || value <= 0 || value > 100) {
        errors.percentOff = "Ingresá un porcentaje mayor a 0 y hasta 100.";
        return null;
      }
      return { type, percentOff: value };
    }
    case "fixed_price": {
      const cents = parsePriceCents(text(form.get("fixedPrice")));
      if (cents === null || cents <= 0n) {
        errors.fixedPrice = "Ingresá el precio del combo en pesos, mayor a 0.";
        return null;
      }
      return { type, fixedPriceCents: cents };
    }
    case "buy_x_get_y": {
      const buy = Number(text(form.get("buyQuantity")));
      const get = Number(text(form.get("getQuantity")));
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 99;
      if (!valid(buy)) errors.buyQuantity = "Entre 1 y 99.";
      if (!valid(get)) errors.getQuantity = "Entre 1 y 99.";
      return valid(buy) && valid(get) ? { type, buyQuantity: buy, getQuantity: get } : null;
    }
    case "free_delivery":
      return { type };
    default:
      errors.type = "Elegí un tipo de promoción.";
      return null;
  }
}

export type PromotionForm = PromotionDraft;

/** Dates arrive as `datetime-local` values typed in the store's time zone. */
export function parsePromotionForm(form: FormData, timeZone: string): Result<PromotionForm, FieldErrors> {
  const errors: FieldErrors = {};
  const name = text(form.get("name")).trim();
  if (name.length < 1 || name.length > 60) errors.name = "Ingresá un nombre de hasta 60 caracteres.";
  const slugInput = text(form.get("slug")).trim().toLowerCase();
  const slug = slugInput === "" ? slugify(name) : slugInput;
  if (!SLUG.test(slug) || slug.length > 80) errors.slug = "Sólo minúsculas, números y guiones.";
  const description = text(form.get("description")).trim();
  if (description.length > 1000) errors.description = "Máximo 1000 caracteres.";
  const badge = text(form.get("badgeText")).trim();
  if (badge.length > 24) errors.badgeText = "Máximo 24 caracteres.";

  const mechanic = parseMechanic(form, errors);

  const channels = [...new Set(texts(form, "channel"))].filter((value): value is FulfilmentMethod => value === "delivery" || value === "pickup");
  if (channels.length === 0) errors.channel = "Elegí al menos un canal.";
  if (mechanic?.type === "free_delivery" && !channels.includes("delivery")) errors.channel = "El envío gratis sólo aplica a delivery.";

  const startsAt = instantFromLocalInput(text(form.get("startsAt")), timeZone);
  const endsAt = instantFromLocalInput(text(form.get("endsAt")), timeZone);
  if (!startsAt) errors.startsAt = "Fecha y hora de inicio inválidas.";
  if (!endsAt) errors.endsAt = "Fecha y hora de fin inválidas.";
  if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = "El fin tiene que ser posterior al inicio.";

  const productIds = texts(form, "itemProduct");
  const quantities = texts(form, "itemQuantity");
  const items: PromotionItem[] = [];
  productIds.forEach((productId, index) => {
    if (productId === "") return;
    const quantity = Number(quantities[index] ?? "1");
    if (!UUID.test(productId)) errors.items = "Producto inválido.";
    else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) errors.items = "La cantidad va de 1 a 20.";
    else items.push({ productId: productId.toLowerCase(), quantity });
  });
  if (new Set(items.map((item) => item.productId)).size !== items.length) errors.items = "Un producto está repetido.";
  if (mechanic?.type === "fixed_price" && items.length === 0) errors.items = "El combo necesita al menos un producto.";
  if (mechanic?.type === "free_delivery" && items.length > 0) errors.items = "El envío gratis no lleva productos.";

  const days = texts(form, "scheduleDay");
  const starts = texts(form, "scheduleStart");
  const ends = texts(form, "scheduleEnd");
  const schedule: PromotionWindow[] = [];
  days.forEach((dayText, index) => {
    if (dayText === "") return;
    const dayOfWeek = Number(dayText);
    const windowStart = starts[index] ?? "";
    const windowEnd = ends[index] ?? "";
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !TIME.test(windowStart) || !TIME.test(windowEnd) || windowStart === windowEnd) {
      errors.schedule = "Cada franja necesita día, inicio y fin distintos (HH:MM).";
      return;
    }
    schedule.push({ dayOfWeek, startsAt: windowStart, endsAt: windowEnd });
  });
  const windowKeys = schedule.map((window) => `${window.dayOfWeek}-${window.startsAt}-${window.endsAt}`);
  if (new Set(windowKeys).size !== windowKeys.length) errors.schedule = "Hay una franja repetida.";

  if (Object.keys(errors).length > 0 || !mechanic || !startsAt || !endsAt) return err(errors);
  return ok({
    fields: { name, slug, description, badgeText: badge === "" ? null : badge, mechanic, channels, startsAt, endsAt, active: checked(form.get("active")) },
    items,
    schedule
  });
}
