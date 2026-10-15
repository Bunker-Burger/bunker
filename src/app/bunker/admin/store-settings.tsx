"use client";

import { CalendarClock, ChevronDown, CirclePlus, CreditCard, GripVertical, Truck, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "../admin.module.css";
import { useOrderSaver } from "./category-tools";
import { PriceField, QuickForm, QuickSubmit, QuickToggle } from "./quick-form";
import { addShiftAction, deleteShiftAction, reorderPaymentMethodsAction, saveStoreContactAction, savePaymentMethodAction } from "./tienda/actions";
import { useDragOrder } from "./use-drag-order";

export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export interface SettingsShift {
  id: string;
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface SettingsPaymentMethod {
  id: string;
  name: string;
  /** What customers read at checkout (fixed copy). */
  note: string;
  enabled: boolean;
  sortOrder: number;
}

export interface StoreSettingsProps {
  deliveryFee: string;
  whatsapp: string;
  pickupAddress: string;
  pickupMapsUrl: string;
  timezone: string;
  shifts: SettingsShift[];
  paymentMethods: SettingsPaymentMethod[];
  /** Why Mercado Pago is not offered right now, or null when it is. */
  mercadoPagoNote: string | null;
}

/**
 * What used to be the "Tienda" screen, inside the control panel (issue #54): delivery fee and
 * WhatsApp, opening hours, and payment methods. Same Server Actions and rules as before.
 */
export function StoreSettings({ deliveryFee, whatsapp, pickupAddress, pickupMapsUrl, timezone, shifts, paymentMethods, mercadoPagoNote }: StoreSettingsProps) {
  return (
    <div className={styles.settingsColumn}>
      <CollapsibleCard icon={Truck} summary={deliverySummary(deliveryFee, whatsapp)} title="Delivery, retiro y WhatsApp" titleId="delivery-title">
        {deliveryFee === "" ? <p className={styles.error}>Cargá el costo de delivery: sin él no se pueden tomar pedidos.</p> : null}
        <QuickForm action={saveStoreContactAction} className={styles.settingsForm} label="Delivery, retiro y WhatsApp">
          <label htmlFor="quick-delivery">Costo de delivery</label>
          <PriceField defaultValue={deliveryFee} id="quick-delivery" name="deliveryFee" />
          <label htmlFor="quick-whatsapp">WhatsApp del local</label>
          <input autoComplete="tel" className={styles.optionName} defaultValue={whatsapp} id="quick-whatsapp" inputMode="tel" name="whatsapp" required />
          <small className={styles.hint}>Con código de país, por ejemplo +54 9 381 555-1234. Los pedidos llegan a este número.</small>
          <label htmlFor="quick-pickup">Dirección para retirar</label>
          <input className={styles.optionName} defaultValue={pickupAddress} id="quick-pickup" maxLength={200} name="pickupAddress" placeholder="Ej: San Lorenzo 877, Aguilares, Tucumán" />
          <label htmlFor="quick-maps">Enlace de Google Maps</label>
          <input className={styles.optionName} defaultValue={pickupMapsUrl} id="quick-maps" inputMode="url" maxLength={500} name="pickupMapsUrl" placeholder="https://maps.app.goo.gl/…" type="url" />
          <small className={styles.hint}>Se muestran al elegir “Retiro en local” en el pedido, con un botón “Cómo llegar”.</small>
          <QuickSubmit className={styles.smallAction}>Guardar</QuickSubmit>
        </QuickForm>
      </CollapsibleCard>

      <OpeningHours shifts={shifts} timezone={timezone} />

      <PaymentMethods mercadoPagoNote={mercadoPagoNote} methods={paymentMethods} />
    </div>
  );
}

/** Collapsed by default: icon and title, a one-line summary, and an arrow that opens it. */
function CollapsibleCard({ icon: Icon, title, titleId, summary, children }: { icon: LucideIcon; title: string; titleId: string; summary: string; children: ReactNode }) {
  return (
    <details className={`${styles.deliveryCard} ${styles.collapsibleCard}`}>
      <summary>
        <span className={styles.collapsibleHead}>
          <h2 id={titleId}>
            <Icon aria-hidden="true" size={20} /> {title}
          </h2>
          <small>{summary}</small>
        </span>
        <ChevronDown aria-hidden="true" className={styles.collapsibleArrow} size={22} />
      </summary>
      {children}
    </details>
  );
}

const ARS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** "$ 1.200 · +5491100000000", or that orders are off without a fee. */
function deliverySummary(deliveryFee: string, whatsapp: string) {
  const fee = deliveryFee === "" ? "Sin costo de delivery: no se toman pedidos" : `Envío $ ${ARS.format(Number(deliveryFee))}`;
  return `${fee} · ${whatsapp}`;
}

/** "Efectivo y Transferencia", in the order customers see them. */
function paymentsSummary(methods: SettingsPaymentMethod[]) {
  const enabled = methods.filter((method) => method.enabled).map((method) => method.name);
  if (enabled.length === 0) return "Ninguno habilitado";
  const list = enabled.length === 1 ? enabled[0]! : `${enabled.slice(0, -1).join(", ")} y ${enabled.at(-1)}`;
  return `${list} ${enabled.length === 1 ? "habilitado" : "habilitados"}`;
}

/** Monday first, as the week is read in Argentina. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "Abierto 6 días · cerrado lun", or "todos los días". */
function hoursSummary(shifts: SettingsShift[]) {
  if (shifts.length === 0) return "Sin turnos: el local queda cerrado";
  const closed = WEEK_ORDER.filter((day) => !shifts.some((shift) => shift.dayOfWeek === day));
  const openDays = 7 - closed.length;
  const open = `Abierto ${openDays} ${openDays === 1 ? "día" : "días"}`;
  if (closed.length === 0) return `${open} · todos los días`;
  return `${open} · cerrado ${closed.map((day) => SHORT_DAYS[day]).join(", ")}`;
}

/**
 * The week, collapsed by default: title, a one-line summary and an arrow; open, one row per day
 * (Monday first) with its shifts as chips, and the form to add one.
 */
function OpeningHours({ shifts, timezone }: { shifts: SettingsShift[]; timezone: string }) {
  const city = (timezone.split("/").pop() ?? timezone).replace(/_/g, " ");
  return (
    <CollapsibleCard icon={CalendarClock} summary={hoursSummary(shifts)} title="Horarios" titleId="hours-title">

      <p className={styles.hint}>Con el modo “Seguir los horarios”, el local abre y cierra solo. Hora de {city}.</p>
      <ul aria-label="Turnos" className={styles.weekList}>
        {WEEK_ORDER.map((day) => {
          const dayShifts = shifts.filter((shift) => shift.dayOfWeek === day);
          return (
            <li key={day}>
              <strong>{WEEKDAYS[day]}</strong>
              {dayShifts.length === 0 ? (
                <span className={styles.closedDay}>Cerrado</span>
              ) : (
                <span className={styles.shiftChips}>
                  {dayShifts.map((shift) => (
                    <span className={styles.shiftChip} key={shift.id}>
                      {shift.opensAt} – {shift.closesAt}
                      {/* Closing after midnight is the next day; 00:00 is just the end of this one. */}
                      {shift.closesAt < shift.opensAt && shift.closesAt !== "00:00" ? <small> +1</small> : null}
                      <QuickForm action={deleteShiftAction} className={styles.inlineForm} label={`Turno del ${WEEKDAYS[day]} ${shift.opensAt}`}>
                        <input name="shiftId" type="hidden" value={shift.id} />
                        <QuickSubmit ariaLabel={`Eliminar turno del ${WEEKDAYS[day]} ${shift.opensAt}`} className={styles.chipRemove}>
                          <X aria-hidden="true" size={14} />
                        </QuickSubmit>
                      </QuickForm>
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <QuickForm action={addShiftAction} className={styles.shiftForm} label="Agregar turno">
        <span className={styles.shiftFormTitle}>Agregar turno</span>
        <label>
          Día
          <select className={styles.categorySelect} defaultValue="1" name="dayOfWeek">
            {WEEK_ORDER.map((day) => (
              <option key={day} value={day}>
                {WEEKDAYS[day]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Abre
          <input className={styles.optionName} defaultValue="19:30" name="opensAt" required type="time" />
        </label>
        <label>
          Cierra
          <input className={styles.optionName} defaultValue="00:00" name="closesAt" required type="time" />
        </label>
        <small className={styles.hint}>Si cierra antes de la hora en que abre, termina al día siguiente (por ejemplo 19:30 a 01:30).</small>
        <QuickSubmit className={styles.smallAction}>
          <CirclePlus aria-hidden="true" size={14} /> Agregar turno
        </QuickSubmit>
      </QuickForm>
    </CollapsibleCard>
  );
}

/** Enabled or not with a switch; the order customers see them in, by dragging. */
function PaymentMethods({ methods, mercadoPagoNote }: { methods: SettingsPaymentMethod[]; mercadoPagoNote: string | null }) {
  const { saveOrder, message } = useOrderSaver(reorderPaymentMethodsAction);
  const { list, rowProps, handleProps } = useDragOrder(methods, (ids) =>
    saveOrder({ method: ids, ...Object.fromEntries(methods.map((method) => [`enabled:${method.id}`, String(method.enabled)])) })
  );
  return (
    <CollapsibleCard icon={CreditCard} summary={paymentsSummary(list)} title="Medios de pago" titleId="payments-title">
      <p className={styles.hint}>Arrastralos para elegir en qué orden los ve el cliente.</p>
      {message ? (
        <p className={styles.quickError} role="alert">
          {message}
        </p>
      ) : null}
      <ul aria-label="Medios de pago" className={styles.methodList}>
        {list.map((method, index) => (
          <li key={method.id} {...rowProps(method.id)}>
            <button className={styles.rowGrip} {...handleProps(method.id, index, `Mover ${method.name}`)}>
              <GripVertical aria-hidden="true" size={18} />
            </button>
            <span className={styles.methodInfo}>
              <strong>{method.name}</strong>
              <small>{method.id === "mercado_pago" && mercadoPagoNote ? mercadoPagoNote : method.note}</small>
            </span>
            <QuickForm action={savePaymentMethodAction} className={styles.inlineForm} label={`Estado de ${method.name}`}>
              <input name="method" type="hidden" value={method.id} />
              <input name="sortOrder" type="hidden" value={method.sortOrder} />
              <QuickToggle defaultChecked={method.enabled} label={`${method.name} habilitado`} name="enabled" offLabel="No" onLabel="Sí" />
            </QuickForm>
          </li>
        ))}
      </ul>
    </CollapsibleCard>
  );
}
