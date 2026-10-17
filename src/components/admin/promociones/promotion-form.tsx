"use client";

import { Bike, CircleCheck, CirclePlus, Clock, Copy, Layers, Package, Percent, Plus, SlidersHorizontal, Trash2, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { FulfilmentMethod, PromotionMechanic } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { savePromotionAction } from "@/app/bunker/admin/promociones/actions";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/app/bunker/admin.module.css";
import { PhotoField, type PhotoValue } from "@/components/admin/catalogo/photo-field";
import { AdminForm, CheckboxField, FieldError, SelectField, TextAreaField, TextField } from "@/components/admin/shared/admin-form";
import { BADGE_SUGGESTIONS, DAY_CHIPS, MECHANIC_HINT, TYPES, WEEKDAYS, mechanicFrom, previewRows, uniformSchedule } from "./promotion-form-model";
import { PromotionPreview } from "./promotion-preview";

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

interface PromotionFormProps {
  products: PromotionFormProduct[];
  deliveryFeeCents: string | null;
  timezone: string;
  defaults: PromotionFormValues;
  action?: typeof savePromotionAction;
  /** The banner photo card, first as in the capture; absent in contexts without uploads. */
  photo?: PhotoValue;
}

const MECHANIC_ICON: Record<PromotionMechanic["type"], LucideIcon> = {
  fixed_price: Package,
  percent_off: Percent,
  buy_x_get_y: Copy,
  free_delivery: Bike
};

export function PromotionForm({ products, deliveryFeeCents, timezone, defaults, action = savePromotionAction, photo }: PromotionFormProps) {
  const [type, setType] = useState(defaults.type);
  const [percentOff, setPercentOff] = useState(defaults.percentOff);
  const [fixedPrice, setFixedPrice] = useState(defaults.fixedPrice);
  const [buyQuantity, setBuyQuantity] = useState(defaults.buyQuantity);
  const [getQuantity, setGetQuantity] = useState(defaults.getQuantity);
  const [channels, setChannels] = useState<FulfilmentMethod[]>(defaults.channels);
  const [items, setItems] = useState(defaults.items);
  const [schedule, setSchedule] = useState(defaults.schedule);
  const [badge, setBadge] = useState(defaults.badgeText);
  const [photoView, setPhotoView] = useState({ url: photo?.url ?? null, focal: photo?.focal ?? { x: 50, y: 50 } });
  const [customBadge, setCustomBadge] = useState(defaults.badgeText !== "" && !BADGE_SUGGESTIONS.includes(defaults.badgeText));
  const initialDays = uniformSchedule(defaults.schedule);
  const [byDay, setByDay] = useState(initialDays === null);
  const [days, setDays] = useState<string[]>(initialDays?.days ?? []);
  const [dayStart, setDayStart] = useState(initialDays?.startsAt ?? "20:00");
  const [dayEnd, setDayEnd] = useState(initialDays?.endsAt ?? "23:30");

  const mechanic = mechanicFrom({ type, percentOff, fixedPrice, buyQuantity, getQuantity });
  const validItems = items
    .filter((item) => item.productId !== "")
    .map((item) => ({ productId: item.productId, quantity: Math.max(1, Number(item.quantity) || 1) }));
  const rows = mechanic ? previewRows(mechanic, channels, validItems, products, deliveryFeeCents === null ? null : BigInt(deliveryFeeCents)) : [];
  const toggleChannel = (channel: FulfilmentMethod, on: boolean) =>
    setChannels((current) => (on ? [...new Set([...current, channel])] : current.filter((value) => value !== channel)));
  const byId = new Map(products.map((product) => [product.id, product]));
  // The capture's value box: what the customer would pay without and with the promotion.
  const headline = rows.length === 1 || type === "fixed_price" ? rows[0] : undefined;
  const saving = headline && headline.normalCents > 0n ? headline.normalCents - headline.promoCents : null;
  const savingPercent = headline && saving !== null && headline.normalCents > 0n ? Math.round(Number((saving * 100n) / headline.normalCents)) : null;

  return (
    <AdminForm action={action} submitLabel={defaults.id ? "Guardar promoción" : "Crear promoción"}>
      {defaults.id ? <input name="promotionId" type="hidden" value={defaults.id} /> : null}
      {photo ? (
        <PhotoField
          key={photo.url ?? ""}
          onView={setPhotoView}
          hint="Se muestra arriba de la carta mientras la promoción está vigente."
          legend="Foto de la promo"
          photo={photo}
          replaceLabel="Reemplazar foto de la promo"
          uploadLabel="Subir foto de la promo"
        />
      ) : null}
      <fieldset className={`${shared.formCard} ${shared.promoCard}`}>
        <legend>
          <span className={shared.promoLegend}>
            <Zap aria-hidden="true" size={18} /> Datos de la promoción
          </span>
          <small className={shared.requiredTag}>Requerido *</small>
        </legend>
        <TextField defaultValue={defaults.name} hint="Máx. 60 caracteres." label="Nombre de la promoción" maxLength={60} name="name" required />
        {defaults.id ? <input name="slug" type="hidden" value={defaults.slug} /> : null}
        <div className={styles.badgePicker}>
          <span className={styles.pickerLabel} id="badge-label">
            Badge o tag de impacto
          </span>
          <div aria-labelledby="badge-label" className={styles.badgeChips} role="group">
            {BADGE_SUGGESTIONS.map((suggestion) => (
              <button
                aria-pressed={!customBadge && badge === suggestion}
                key={suggestion}
                onClick={() => {
                  setCustomBadge(false);
                  setBadge(badge === suggestion ? "" : suggestion);
                }}
                type="button"
              >
                {suggestion === badge && !customBadge ? <Zap aria-hidden="true" size={12} /> : null}
                {suggestion}
              </button>
            ))}
            <button aria-pressed={customBadge} onClick={() => setCustomBadge((value) => !value)} type="button">
              <Plus aria-hidden="true" size={12} /> Personalizado
            </button>
          </div>
          {customBadge ? (
            <TextField hint="Etiqueta corta que se ve en la carta." label="Tag personalizado" maxLength={24} name="badgeText" onChange={(event) => setBadge(event.target.value)} value={badge} />
          ) : (
            <input name="badgeText" type="hidden" value={badge} />
          )}
        </div>
        <TextAreaField defaultValue={defaults.description} label="Descripción y términos" maxLength={1000} name="description" rows={3} />
      </fieldset>

      <fieldset className={`${shared.formCard} ${shared.promoCard}`}>
        <legend>
          <span className={shared.promoLegend}>Mecánica y valor comercial</span>
          <small className={shared.requiredTag}>Tarifa activa</small>
        </legend>
        <fieldset className={shared.mechanicTiles}>
          <legend className="sr-only">Tipo</legend>
          <div>
            {TYPES.map((option) => {
              const Icon = MECHANIC_ICON[option.value];
              return (
                <label className={option.value === type ? shared.mechanicTileActive : shared.mechanicTile} key={option.value}>
                  <input checked={option.value === type} name="type" onChange={() => setType(option.value)} type="radio" value={option.value} />
                  <span className={shared.tileIcons} aria-hidden="true">
                    <Icon size={20} />
                    {option.value === type ? <CircleCheck size={18} /> : null}
                  </span>
                  <strong>{option.label}</strong>
                  <small>{MECHANIC_HINT[option.value]}</small>
                </label>
              );
            })}
          </div>
        </fieldset>

      {type !== "free_delivery" ? (
        <fieldset className={shared.fieldset}>
          <legend>
            <span className={shared.promoLegend}>
              <Layers aria-hidden="true" size={18} /> {type === "fixed_price" ? "Productos incluidos en el combo" : "Productos (vacío = todos)"}
            </span>
          </legend>
          <FieldError id="items-error" name="items" />
          {items.map((item, index) => {
            const chosen = byId.get(item.productId);
            return (
              <div className={shared.comboRow} key={index}>
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
                  prefix="x"
                  type="number"
                  value={item.quantity}
                />
                <button aria-label={`Quitar producto ${index + 1}`} className={styles.trashAction} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} type="button">
                  <Trash2 aria-hidden="true" size={18} />
                </button>
                {chosen ? <small className={styles.comboPrice}>{formatArs(BigInt(chosen.priceCents))} c/u</small> : null}
              </div>
            );
          })}
          <button className={styles.addDashed} onClick={() => setItems((current) => [...current, { productId: "", quantity: "1" }])} type="button">
            <CirclePlus aria-hidden="true" size={18} /> Agregar producto
          </button>
        </fieldset>
      ) : null}

        <div className={styles.valueBox}>
          {type === "fixed_price" ? (
            <div className={styles.valuePair}>
              <div>
                <span className={styles.valueLabel}>Precio normal (tachado)</span>
                <span className={styles.valueNormal}>{headline ? <s>{formatArs(headline.normalCents)}</s> : "Elegí productos"}</span>
              </div>
              <TextField inputMode="decimal" label="Precio promocional" min={0} name="fixedPrice" onChange={(event) => setFixedPrice(event.target.value)} prefix="$" step="0.01" type="number" value={fixedPrice} />
            </div>
          ) : null}
          {type === "percent_off" ? (
            <TextField inputMode="decimal" label="Descuento (%)" max={100} min={0.01} name="percentOff" onChange={(event) => setPercentOff(event.target.value)} prefix="%" step="0.01" type="number" value={percentOff} />
          ) : null}
          {type === "buy_x_get_y" ? (
            <div className={styles.valuePair}>
              <TextField label="Pagás" max={99} min={1} name="buyQuantity" onChange={(event) => setBuyQuantity(event.target.value)} type="number" value={buyQuantity} />
              <TextField label="Gratis" max={99} min={1} name="getQuantity" onChange={(event) => setGetQuantity(event.target.value)} type="number" value={getQuantity} />
            </div>
          ) : null}
          {type === "free_delivery" ? <p className={shared.hint}>El envío a domicilio queda en $ 0 mientras la promoción esté vigente.</p> : null}
          {saving !== null && saving > 0n ? (
            <p className={styles.savingBox}>
              <span>Ahorro para el cliente:</span>
              <strong>
                {formatArs(saving)}
                {savingPercent ? ` (-${savingPercent}%)` : null}
              </strong>
            </p>
          ) : null}
        </div>

        <section aria-labelledby="preview-title" className={styles.preview}>
          <h3 id="preview-title">Vista previa de precios</h3>
          {rows.length === 0 ? (
            <p className={shared.hint}>
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
          <p className={shared.hint}>Precios de ejemplo con esta promo, sin tener en cuenta fechas ni horarios.</p>
        </section>
      </fieldset>

      <fieldset className={`${shared.formCard} ${shared.promoCard}`}>
        <legend>
          <span className={shared.promoLegend}>
            <Clock aria-hidden="true" size={18} /> Reglas de activación y vigencia
          </span>
          <small className={shared.requiredTag}>Calendario</small>
        </legend>
        <div className={styles.valuePair}>
          <TextField defaultValue={defaults.startsAt} label="Vigente desde" name="startsAt" required type="datetime-local" />
          <TextField defaultValue={defaults.endsAt} label="Hasta" name="endsAt" required type="datetime-local" />
        </div>
        <small className={shared.hint}>Fechas y horas de {timezone}.</small>

        {byDay ? (
          <fieldset className={shared.fieldset}>
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
                <button aria-label={`Quitar franja ${index + 1}`} className={styles.trashAction} onClick={() => setSchedule((current) => current.filter((_, i) => i !== index))} type="button">
                  <Trash2 aria-hidden="true" size={18} />
                </button>
              </div>
            ))}
            <button className={styles.addDashed} onClick={() => setSchedule((current) => [...current, { dayOfWeek: "1", startsAt: "19:00", endsAt: "23:00" }])} type="button">
              <CirclePlus aria-hidden="true" size={18} /> Agregar franja
            </button>
          </fieldset>
        ) : (
          <div className={styles.dayPicker}>
            <span className={styles.pickerLabel} id="days-label">
              Días de aplicación
            </span>
            <div aria-labelledby="days-label" className={styles.dayChips} role="group">
              {DAY_CHIPS.map((day) => (
                <button
                  aria-label={day.name}
                  aria-pressed={days.includes(day.value)}
                  key={day.value}
                  onClick={() => setDays((current) => (current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value]))}
                  type="button"
                >
                  {day.short}
                </button>
              ))}
            </div>
            <small className={shared.hint}>
              {days.length === 0 ? "Sin días marcados: rige todo el período." : `Activa: ${DAY_CHIPS.filter((day) => days.includes(day.value)).map((day) => day.name).join(", ")}.`}
            </small>
            <div className={styles.valuePair}>
              <TextField label="Hora inicio" name="dayStart" onChange={(event) => setDayStart(event.target.value)} type="time" value={dayStart} />
              <TextField label="Hora cierre" name="dayEnd" onChange={(event) => setDayEnd(event.target.value)} type="time" value={dayEnd} />
            </div>
            {/* The same windows the per-day list sends: one per marked day, with these hours. */}
            {DAY_CHIPS.filter((day) => days.includes(day.value)).map((day) => (
              <span hidden key={day.value}>
                <input name="scheduleDay" type="hidden" value={day.value} />
                <input name="scheduleStart" type="hidden" value={dayStart} />
                <input name="scheduleEnd" type="hidden" value={dayEnd} />
              </span>
            ))}
            <FieldError id="schedule-error" name="schedule" />
            <button
              className={styles.linkAction}
              onClick={() => {
                setSchedule(DAY_CHIPS.filter((day) => days.includes(day.value)).map((day) => ({ dayOfWeek: day.value, startsAt: dayStart, endsAt: dayEnd })));
                setByDay(true);
              }}
              type="button"
            >
              Horarios distintos por día
            </button>
          </div>
        )}
      </fieldset>

      <fieldset className={`${shared.formCard} ${shared.promoCard}`}>
        <legend>
          <span className={shared.promoLegend}>
            <SlidersHorizontal aria-hidden="true" size={18} /> Estado y canales de venta
          </span>
          <small className={shared.requiredTag}>Inmediato</small>
        </legend>
        <div className={shared.checkGroup}>
          <CheckboxField defaultChecked={defaults.active} hint="Una promoción pausada no se aplica aunque esté en fecha." label="Activa" name="active" />
        </div>
        <fieldset className={`${shared.fieldset} ${shared.checkGroup}`}>
          <legend>Canales de venta</legend>
          <FieldError id="channel-error" name="channel" />
          {(["delivery", "pickup"] as const).map((channel) => (
            <div className={shared.checkField} key={channel}>
              <input checked={channels.includes(channel)} id={`channel-${channel}`} name="channel" onChange={(event) => toggleChannel(channel, event.target.checked)} type="checkbox" value={channel} />
              <label htmlFor={`channel-${channel}`}>{channel === "delivery" ? "Delivery" : "Retiro en el local"}</label>
            </div>
          ))}
        </fieldset>
      </fieldset>

      <PromotionPreview badge={badge} focal={photoView.focal} items={validItems} mechanic={mechanic} photoUrl={photoView.url} products={products} />
    </AdminForm>
  );
}
