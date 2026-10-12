"use client";

import { useState } from "react";
import { promotionDiscount, type PromotionLine } from "@/domain/promotions";
import type { FulfilmentMethod, PromotionMechanic, PromotionRule } from "@/domain/types";
import { formatArs } from "@/lib/money";
import styles from "../../admin.module.css";
import { AdminForm, CheckboxField, FieldError, SelectField, TextAreaField, TextField } from "../admin-form";
import { savePromotionAction } from "./actions";

export interface PromotionFormProduct {
  id: string;
  name: string;
  /** Base price in cents, as text (no bigint across the server/client boundary). */
  priceCents: string;
  /** Drafts can be picked for a promotion, but customers cannot order them yet. */
  published: boolean;
}

export interface PromotionFormValues {
  id: string;
  name: string;
  slug: string;
  description: string;
  badgeText: string;
  type: PromotionMechanic["type"];
  percentOff: string;
  fixedPrice: string;
  buyQuantity: string;
  getQuantity: string;
  channels: FulfilmentMethod[];
  /** `datetime-local` values in the store time zone. */
  startsAt: string;
  endsAt: string;
  active: boolean;
  items: Array<{ productId: string; quantity: string }>;
  schedule: Array<{ dayOfWeek: string; startsAt: string; endsAt: string }>;
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const TYPES: Array<{ value: PromotionMechanic["type"]; label: string }> = [
  { value: "percent_off", label: "Porcentaje de descuento" },
  { value: "fixed_price", label: "Combo a precio fijo" },
  { value: "buy_x_get_y", label: "Llevá X, pagá Y" },
  { value: "free_delivery", label: "Envío gratis" }
];

interface PromotionFormProps {
  products: PromotionFormProduct[];
  deliveryFeeCents: string | null;
  timezone: string;
  defaults: PromotionFormValues;
  action?: typeof savePromotionAction;
}

/** Pesos as typed ("7800" or "7800.5") → cents, or null. */
function cents(value: string): bigint | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")) : null;
}

function mechanicFrom(values: Pick<PromotionFormValues, "type" | "percentOff" | "fixedPrice" | "buyQuantity" | "getQuantity">): PromotionMechanic | null {
  switch (values.type) {
    case "percent_off": {
      const percent = Number(values.percentOff);
      return values.percentOff.trim() !== "" && percent > 0 && percent <= 100 ? { type: "percent_off", percentOff: percent } : null;
    }
    case "fixed_price": {
      const price = cents(values.fixedPrice);
      return price && price > 0n ? { type: "fixed_price", fixedPriceCents: price } : null;
    }
    case "buy_x_get_y": {
      const buy = Number(values.buyQuantity);
      const get = Number(values.getQuantity);
      return Number.isInteger(buy) && Number.isInteger(get) && buy >= 1 && get >= 1 ? { type: "buy_x_get_y", buyQuantity: buy, getQuantity: get } : null;
    }
    case "free_delivery":
      return { type: "free_delivery" };
  }
}

interface PreviewRow {
  label: string;
  normalCents: bigint;
  promoCents: bigint;
}

/** Derived prices from the same engine that discounts the real quote (dates and windows aside). */
export function previewRows(
  mechanic: PromotionMechanic,
  channels: FulfilmentMethod[],
  items: Array<{ productId: string; quantity: number }>,
  products: PromotionFormProduct[],
  deliveryFeeCents: bigint | null
): PreviewRow[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const fulfilment: FulfilmentMethod = mechanic.type === "free_delivery" || !channels.includes("pickup") ? "delivery" : "pickup";
  const rule: PromotionRule = {
    id: "preview",
    slug: "preview",
    name: "Vista previa",
    description: "",
    badgeText: null,
    priority: 0,
    active: true,
    startsAt: new Date(0),
    endsAt: new Date(8.64e15),
    mechanic,
    channels,
    items,
    schedule: []
  };
  const context = { now: new Date(), timezone: "UTC", fulfilment, deliveryCents: fulfilment === "delivery" ? (deliveryFeeCents ?? 0n) : 0n };
  const line = (productId: string, quantity: number): PromotionLine | null => {
    const product = byId.get(productId);
    if (!product) return null;
    const price = BigInt(product.priceCents);
    return { productId, quantity, unitPriceCents: price, basePriceCents: price };
  };
  const total = (lines: PromotionLine[]) => lines.reduce((sum, current) => sum + current.unitPriceCents * BigInt(current.quantity), 0n);

  if (mechanic.type === "free_delivery") {
    if (deliveryFeeCents === null) return [];
    const discount = promotionDiscount(rule, [{ productId: "any", quantity: 1, unitPriceCents: 0n, basePriceCents: 0n }], context);
    return [{ label: "Envío a domicilio", normalCents: deliveryFeeCents, promoCents: deliveryFeeCents - discount.deliveryDiscountCents }];
  }
  if (mechanic.type === "fixed_price") {
    const lines = items.map((item) => line(item.productId, item.quantity)).filter((value): value is PromotionLine => value !== null);
    if (lines.length === 0) return [];
    const normal = total(lines);
    const label = items.map((item) => `${item.quantity}× ${byId.get(item.productId)?.name ?? "?"}`).join(" + ");
    return [{ label, normalCents: normal, promoCents: normal - promotionDiscount(rule, lines, context).productDiscountCents }];
  }
  // "Every product" means what customers can order: published products only.
  const eligible = items.length > 0 ? items.map((item) => item.productId) : products.filter((product) => product.published).map((product) => product.id);
  const quantity = mechanic.type === "buy_x_get_y" ? mechanic.buyQuantity + mechanic.getQuantity : 1;
  return eligible.slice(0, 8).flatMap((productId) => {
    const single = line(productId, quantity);
    if (!single) return [];
    const normal = total([single]);
    return [{ label: `${quantity > 1 ? `${quantity}× ` : ""}${byId.get(productId)!.name}`, normalCents: normal, promoCents: normal - promotionDiscount(rule, [single], context).productDiscountCents }];
  });
}

/** One line under each mechanic tile, as in the capture. */
const MECHANIC_HINT: Record<PromotionMechanic["type"], string> = {
  fixed_price: "Combo armado con precio cerrado",
  percent_off: "Rebaja porcentual directa",
  buy_x_get_y: "Llevás más, pagás menos",
  free_delivery: "Delivery $0 sobre el pedido"
};

/** Quick tags; the field stays free text. */
const BADGE_SUGGESTIONS = ["2x1", "30% OFF", "Combo dúo", "Happy hour"];

export function PromotionForm({ products, deliveryFeeCents, timezone, defaults, action = savePromotionAction }: PromotionFormProps) {
  const [type, setType] = useState(defaults.type);
  const [percentOff, setPercentOff] = useState(defaults.percentOff);
  const [fixedPrice, setFixedPrice] = useState(defaults.fixedPrice);
  const [buyQuantity, setBuyQuantity] = useState(defaults.buyQuantity);
  const [getQuantity, setGetQuantity] = useState(defaults.getQuantity);
  const [channels, setChannels] = useState<FulfilmentMethod[]>(defaults.channels);
  const [items, setItems] = useState(defaults.items);
  const [schedule, setSchedule] = useState(defaults.schedule);
  const [badge, setBadge] = useState(defaults.badgeText);

  const mechanic = mechanicFrom({ type, percentOff, fixedPrice, buyQuantity, getQuantity });
  const validItems = items
    .filter((item) => item.productId !== "")
    .map((item) => ({ productId: item.productId, quantity: Math.max(1, Number(item.quantity) || 1) }));
  const rows = mechanic ? previewRows(mechanic, channels, validItems, products, deliveryFeeCents === null ? null : BigInt(deliveryFeeCents)) : [];
  const toggleChannel = (channel: FulfilmentMethod, on: boolean) =>
    setChannels((current) => (on ? [...new Set([...current, channel])] : current.filter((value) => value !== channel)));

  return (
    <AdminForm action={action} submitLabel={defaults.id ? "Guardar promoción" : "Crear promoción"}>
      {defaults.id ? <input name="promotionId" type="hidden" value={defaults.id} /> : null}
      <fieldset className={styles.formCard}>
        <legend>
          Datos de la promoción <small className={styles.requiredTag}>Requerido *</small>
        </legend>
        <TextField defaultValue={defaults.name} hint="Máx. 60 caracteres." label="Nombre de la promoción" maxLength={60} name="name" required />
        {defaults.id ? <input name="slug" type="hidden" value={defaults.slug} /> : null}
        <TextAreaField defaultValue={defaults.description} label="Descripción" maxLength={1000} name="description" rows={2} />
        <TextField hint="Etiqueta corta en la carta (opcional)." label="Badge o tag de impacto" maxLength={24} name="badgeText" onChange={(event) => setBadge(event.target.value)} value={badge} />
        <div aria-label="Tags sugeridos" className={styles.badgeChips} role="group">
          {BADGE_SUGGESTIONS.map((suggestion) => (
            <button aria-pressed={badge === suggestion} key={suggestion} onClick={() => setBadge(badge === suggestion ? "" : suggestion)} type="button">
              {suggestion}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.formCard}>
        <legend>Mecánica y valor comercial</legend>
        <fieldset className={styles.mechanicTiles}>
          <legend>Tipo</legend>
          <div>
            {TYPES.map((option) => (
              <label className={option.value === type ? styles.mechanicTileActive : styles.mechanicTile} key={option.value}>
                <input checked={option.value === type} name="type" onChange={() => setType(option.value)} type="radio" value={option.value} />
                <strong>{option.label}</strong>
                <small>{MECHANIC_HINT[option.value]}</small>
              </label>
            ))}
          </div>
        </fieldset>
        {type === "percent_off" ? (
          <TextField inputMode="decimal" label="Descuento (%)" max={100} min={0.01} name="percentOff" onChange={(event) => setPercentOff(event.target.value)} step="0.01" type="number" value={percentOff} />
        ) : null}
        {type === "fixed_price" ? (
          <TextField inputMode="decimal" label="Precio del combo" min={0} name="fixedPrice" onChange={(event) => setFixedPrice(event.target.value)} step="0.01" type="number" value={fixedPrice} />
        ) : null}
        {type === "buy_x_get_y" ? (
          <div className={styles.focalInputs}>
            <TextField label="Pagás" max={99} min={1} name="buyQuantity" onChange={(event) => setBuyQuantity(event.target.value)} type="number" value={buyQuantity} />
            <TextField label="Gratis" max={99} min={1} name="getQuantity" onChange={(event) => setGetQuantity(event.target.value)} type="number" value={getQuantity} />
          </div>
        ) : null}

        <section aria-labelledby="preview-title" className={styles.preview}>
          <h3 id="preview-title">Vista previa de precios</h3>
          {rows.length === 0 ? (
            <p className={styles.hint}>
              {mechanic ? (type === "free_delivery" ? "Configurá la tarifa de delivery para ver el ahorro." : "Elegí productos para ver los precios.") : "Completá los datos del descuento para ver los precios."}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Precio normal</th>
                  <th scope="col">Con la promo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{formatArs(row.normalCents)}</td>
                    <td>
                      <strong>{formatArs(row.promoCents)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.hint}>Calculado con el mismo motor que el checkout; no considera fechas ni franjas.</p>
        </section>
      </fieldset>

      {type !== "free_delivery" ? (
        <fieldset className={styles.formCard}>
          <legend>{type === "fixed_price" ? "Productos del combo" : "Productos (vacío = todos)"}</legend>
          <FieldError id="items-error" name="items" />
          {items.map((item, index) => (
            <div className={styles.rowFields} key={index}>
              <SelectField
                label={`Producto ${index + 1}`}
                name="itemProduct"
                onChange={(event) => setItems((current) => current.map((row, i) => (i === index ? { ...row, productId: event.target.value } : row)))}
                value={item.productId}
              >
                <option value="">Elegí un producto</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {formatArs(BigInt(product.priceCents))}
                    {product.published ? "" : " (borrador)"}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Cantidad"
                max={20}
                min={1}
                name="itemQuantity"
                onChange={(event) => setItems((current) => current.map((row, i) => (i === index ? { ...row, quantity: event.target.value } : row)))}
                type="number"
                value={item.quantity}
              />
              <button aria-label={`Quitar producto ${index + 1}`} className={styles.iconAction} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} type="button">
                ✕
              </button>
            </div>
          ))}
          <button className={styles.secondaryAction} onClick={() => setItems((current) => [...current, { productId: "", quantity: "1" }])} type="button">
            Agregar producto
          </button>
        </fieldset>
      ) : null}

      <fieldset className={styles.formCard}>
        <legend>Reglas de activación y vigencia</legend>
        <div className={styles.focalInputs}>
          <TextField defaultValue={defaults.startsAt} hint={`Hora de ${timezone}.`} label="Desde" name="startsAt" required type="datetime-local" />
          <TextField defaultValue={defaults.endsAt} label="Hasta" name="endsAt" required type="datetime-local" />
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Franjas semanales (vacío = todo el período)</legend>
          <FieldError id="schedule-error" name="schedule" />
          {schedule.map((window, index) => (
            <div className={styles.rowFields} key={index}>
              <SelectField
                label={`Día ${index + 1}`}
                name="scheduleDay"
                onChange={(event) => setSchedule((current) => current.map((row, i) => (i === index ? { ...row, dayOfWeek: event.target.value } : row)))}
                value={window.dayOfWeek}
              >
                {WEEKDAYS.map((day, dayIndex) => (
                  <option key={day} value={dayIndex}>
                    {day}
                  </option>
                ))}
              </SelectField>
              <TextField label="Desde" name="scheduleStart" onChange={(event) => setSchedule((current) => current.map((row, i) => (i === index ? { ...row, startsAt: event.target.value } : row)))} type="time" value={window.startsAt} />
              <TextField label="Hasta" name="scheduleEnd" onChange={(event) => setSchedule((current) => current.map((row, i) => (i === index ? { ...row, endsAt: event.target.value } : row)))} type="time" value={window.endsAt} />
              <button aria-label={`Quitar franja ${index + 1}`} className={styles.iconAction} onClick={() => setSchedule((current) => current.filter((_, i) => i !== index))} type="button">
                ✕
              </button>
            </div>
          ))}
          <button className={styles.secondaryAction} onClick={() => setSchedule((current) => [...current, { dayOfWeek: "1", startsAt: "19:00", endsAt: "23:00" }])} type="button">
            Agregar franja
          </button>
        </fieldset>
      </fieldset>

      <fieldset className={styles.formCard}>
        <legend>Estado y canales de venta</legend>
        <div className={styles.checkGroup}>
          <CheckboxField defaultChecked={defaults.active} hint="Una promoción pausada no se aplica aunque esté en fecha." label="Activa" name="active" />
        </div>
        <fieldset className={`${styles.fieldset} ${styles.checkGroup}`}>
          <legend>Canales de venta</legend>
          <FieldError id="channel-error" name="channel" />
          {(["delivery", "pickup"] as const).map((channel) => (
            <div className={styles.checkField} key={channel}>
              <input checked={channels.includes(channel)} id={`channel-${channel}`} name="channel" onChange={(event) => toggleChannel(channel, event.target.checked)} type="checkbox" value={channel} />
              <label htmlFor={`channel-${channel}`}>{channel === "delivery" ? "Delivery" : "Retiro en el local"}</label>
            </div>
          ))}
        </fieldset>
      </fieldset>
    </AdminForm>
  );
}
