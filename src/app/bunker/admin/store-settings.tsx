"use client";

import { CalendarClock, CirclePlus, CreditCard, GripVertical, Truck, X } from "lucide-react";
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

      <section aria-labelledby="hours-title" className={styles.deliveryCard}>
        <div>
          <h2 id="hours-title">
            <CalendarClock aria-hidden="true" size={20} /> Horarios
          </h2>
          <p>Con “Seguir los horarios”, el local abre y cierra solo. Un turno que cierra antes de abrir termina al día siguiente. Zona horaria: {timezone}.</p>
        </div>
        {shifts.length === 0 ? <p className={styles.empty}>No hay turnos: siguiendo los horarios, el local queda cerrado.</p> : null}
        <ul aria-label="Turnos" className={styles.shiftList}>
          {shifts.map((shift) => (
            <li key={shift.id}>
              <span>
                <strong>{WEEKDAYS[shift.dayOfWeek]}</strong> {shift.opensAt} a {shift.closesAt}
                {shift.closesAt <= shift.opensAt ? <span className={styles.badgeMuted}> Cruza medianoche</span> : null}
              </span>
              <QuickForm action={deleteShiftAction} className={styles.inlineForm} label={`Turno del ${WEEKDAYS[shift.dayOfWeek]} ${shift.opensAt}`}>
                <input name="shiftId" type="hidden" value={shift.id} />
                <QuickSubmit ariaLabel={`Eliminar turno del ${WEEKDAYS[shift.dayOfWeek]} ${shift.opensAt}`} className={styles.iconSmall}>
                  <X aria-hidden="true" size={16} />
                </QuickSubmit>
              </QuickForm>
            </li>
          ))}
        </ul>
        <QuickForm action={addShiftAction} className={styles.shiftForm} label="Agregar turno">
          <select aria-label="Día" className={styles.categorySelect} defaultValue="1" name="dayOfWeek">
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
          <input aria-label="Abre" className={styles.optionName} defaultValue="20:00" name="opensAt" required type="time" />
          <input aria-label="Cierra" className={styles.optionName} defaultValue="00:30" name="closesAt" required type="time" />
          <QuickSubmit className={styles.smallAction}>
            <CirclePlus aria-hidden="true" size={14} /> Turno
          </QuickSubmit>
        </QuickForm>
      </section>

      <PaymentMethods mercadoPagoNote={mercadoPagoNote} methods={paymentMethods} />

      <Link className={styles.viewMenuLink} href="/">
        Ver la carta como cliente
      </Link>
    </div>
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
