"use client";

import { CalendarClock, ChevronDown, CirclePlus, CreditCard, GripVertical, Truck, X } from "lucide-react";
import Link from "next/link";
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
export function StoreSettings({ deliveryFee, whatsapp, timezone, shifts, paymentMethods, mercadoPagoNote }: StoreSettingsProps) {
  return (
    <div className={styles.settingsColumn}>
      <section aria-labelledby="delivery-title" className={styles.deliveryCard}>
        <div>
          <h2 id="delivery-title">
            <Truck aria-hidden="true" size={20} /> Delivery y WhatsApp
          </h2>
          <p>Sin costo de delivery cargado, los pedidos quedan deshabilitados.</p>
        </div>
        <QuickForm action={saveStoreContactAction} className={styles.settingsForm} label="Delivery y WhatsApp">
          <label htmlFor="quick-delivery">Costo de delivery</label>
          <PriceField defaultValue={deliveryFee} id="quick-delivery" name="deliveryFee" />
          <label htmlFor="quick-whatsapp">WhatsApp del local</label>
          <input autoComplete="tel" className={styles.optionName} defaultValue={whatsapp} id="quick-whatsapp" inputMode="tel" name="whatsapp" required />
          <small className={styles.hint}>Con código de país, por ejemplo +54 9 381 555-1234. Los pedidos llegan a este número.</small>
          <QuickSubmit className={styles.smallAction}>Guardar</QuickSubmit>
        </QuickForm>
      </section>

      <OpeningHours shifts={shifts} timezone={timezone} />

      <PaymentMethods mercadoPagoNote={mercadoPagoNote} methods={paymentMethods} />

      <Link className={styles.viewMenuLink} href="/">
        Ver la carta como cliente
      </Link>
    </div>
  );
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
    <details className={`${styles.deliveryCard} ${styles.collapsibleCard}`}>
      <summary>
        <span className={styles.collapsibleHead}>
          <h2 id="hours-title">
            <CalendarClock aria-hidden="true" size={20} /> Horarios
          </h2>
          <small>{hoursSummary(shifts)}</small>
        </span>
        <ChevronDown aria-hidden="true" className={styles.collapsibleArrow} size={22} />
      </summary>

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
    </details>
  );
}

/** Enabled or not with a switch; the order customers see them in, by dragging. */
function PaymentMethods({ methods, mercadoPagoNote }: { methods: SettingsPaymentMethod[]; mercadoPagoNote: string | null }) {
  const { saveOrder, message } = useOrderSaver(reorderPaymentMethodsAction);
  const { list, rowProps, handleProps } = useDragOrder(methods, (ids) =>
    saveOrder({ method: ids, ...Object.fromEntries(methods.map((method) => [`enabled:${method.id}`, String(method.enabled)])) })
  );
  return (
    <section aria-labelledby="payments-title" className={styles.deliveryCard}>
      <div>
        <h2 id="payments-title">
          <CreditCard aria-hidden="true" size={20} /> Medios de pago
        </h2>
        <p>Arrastralos para elegir en qué orden los ve el cliente.</p>
      </div>
      {message ? (
        <p className={styles.quickError} role="alert">
          {message}
        </p>
      ) : null}
      <ul aria-label="Medios de pago" className={styles.methodList}>
        {list.map((method, index) => (
          <li key={method.id} {...rowProps(method.id, index)}>
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
    </section>
  );
}
