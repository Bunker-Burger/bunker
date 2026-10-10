import type { StoreState, StoreStatus } from "@/domain/store-status";
import type { PaymentMethodKind, PaymentMethodSetting } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { getStoreAdminView, PAYMENT_METHODS, type StoredShift } from "@/server/store-admin";
import styles from "../../admin.module.css";
import { AdminForm, CheckboxField, SelectField, TextAreaField, TextField } from "../admin-form";
import { pesos } from "../catalogo/product-props";
import { addShiftAction, deleteShiftAction, savePaymentMethodAction, saveStoreContactAction, setStoreStatusAction } from "./actions";
import { PublicStatusText } from "./public-status-text";

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const STATE_LABEL: Record<StoreState, string> = { open: "Abierto", paused: "Pausado", closed: "Cerrado" };

const REASON: Record<StoreStatus["reason"], string> = {
  schedule: "según los horarios",
  manual_open: "abierto manualmente",
  manual_paused: "pausado manualmente",
  manual_closed: "cerrado manualmente",
  delivery_fee_missing: "sin tarifa de delivery: los pedidos están deshabilitados"
};

const OVERRIDE_OPTIONS = [
  { value: "auto", label: "Seguir los horarios" },
  { value: "open", label: "Abierto (ignora los horarios)" },
  { value: "paused", label: "Pausado" },
  { value: "closed", label: "Cerrado" }
] as const;

const METHOD_LABEL: Record<PaymentMethodKind, string> = { cash: "Efectivo", bank_transfer: "Transferencia", mercado_pago: "Mercado Pago" };

/** "miércoles 00:00" in the store's time zone. */
function when(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("es-AR", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.hour}:${parts.minute}`;
}

export default async function StoreAdminPage() {
  const view = await getStoreAdminView();
  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="store-title">
        <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
        <h1 id="store-title">Tienda</h1>
        <p className={styles.error} role="alert">
          No pudimos cargar la configuración. Recargá la página en unos segundos.
        </p>
      </section>
    );
  }

  const { catalog, shifts, status, publicStatus, mercadoPago } = view.value;
  const { store } = catalog;
  const methods = PAYMENT_METHODS.map(
    (method): PaymentMethodSetting =>
      store.paymentMethods.find((candidate) => candidate.method === method) ?? {
        method,
        displayName: METHOD_LABEL[method],
        instructions: "",
        enabled: false,
        sortOrder: (PAYMENT_METHODS.indexOf(method) + 1) * 10
      }
  );
  const enabledMethods = store.paymentMethods.filter((method) => method.enabled);

  return (
    <section className={styles.adminPanel} aria-labelledby="store-title">
      <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
      <h1 id="store-title">Tienda</h1>
      <p>Estado del local, horarios, delivery y medios de pago. Los cambios rigen desde el próximo pedido.</p>

      <section aria-labelledby="status-title" className={styles.tabPanel}>
        <h2 id="status-title">Estado ahora</h2>
        <p className={styles.statusLine}>
          <span className={status.acceptingOrders ? styles.badge : status.state === "paused" ? styles.badgeWarning : styles.badgeMuted}>{STATE_LABEL[status.state]}</span>{" "}
          {REASON[status.reason]}
          {status.closesAt ? ` · cierra el ${when(status.closesAt, store.timezone)}` : null}
          {status.nextOpeningAt ? ` · próximo turno: ${when(status.nextOpeningAt, store.timezone)}` : null}
        </p>
        <AdminForm action={setStoreStatusAction} submitLabel="Aplicar estado">
          <SelectField defaultValue={store.statusOverride} label="Pedidos" name="statusOverride">
            {OVERRIDE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
          <p className={styles.hint}>“Seguir los horarios” y “Abierto” toman pedidos: necesitan una tarifa de delivery configurada.</p>
        </AdminForm>
      </section>

      <section aria-labelledby="contact-title" className={styles.tabPanel}>
        <h2 id="contact-title">Delivery y WhatsApp</h2>
        <AdminForm action={saveStoreContactAction} submitLabel="Guardar">
          <TextField
            defaultValue={store.deliveryFeeCents === null ? "" : pesos(store.deliveryFeeCents)}
            hint="Tarifa fija en pesos. Vacía significa sin configurar: los pedidos quedan deshabilitados."
            inputMode="decimal"
            label="Tarifa de delivery"
            min={0}
            name="deliveryFee"
            step="0.01"
            type="number"
          />
          <TextField
            autoComplete="tel"
            defaultValue={store.whatsappE164}
            hint="Con código de país, por ejemplo +54 9 381 555-1234. Los pedidos por WhatsApp llegan a este número."
            inputMode="tel"
            label="WhatsApp del local"
            name="whatsapp"
            required
          />
        </AdminForm>
      </section>

      <section aria-labelledby="hours-title" className={styles.tabPanel}>
        <h2 id="hours-title">Horarios</h2>
        <p className={styles.hint}>Zona horaria: {store.timezone}. Un turno que cierra antes de abrir termina al día siguiente (por ejemplo 19:30 a 01:30).</p>
        {shifts.length === 0 ? <p className={styles.empty}>No hay turnos: siguiendo los horarios, el local queda cerrado.</p> : <ShiftList shifts={shifts} />}
        <details className={styles.disclosure}>
          <summary>Agregar turno</summary>
          <AdminForm action={addShiftAction} submitLabel="Agregar turno">
            <SelectField defaultValue="1" label="Día" name="dayOfWeek">
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </SelectField>
            <div className={styles.focalInputs}>
              <TextField label="Abre" name="opensAt" required type="time" />
              <TextField label="Cierra" name="closesAt" required type="time" />
            </div>
          </AdminForm>
        </details>
      </section>

      <section aria-labelledby="payments-title" className={styles.tabPanel}>
        <h2 id="payments-title">Medios de pago</h2>
        <p className={styles.hint}>
          Mercado Pago: {mercadoPago.available ? "disponible para los clientes." : "no se ofrece a los clientes ahora"}
          {mercadoPago.available ? null : ` (${mercadoPago.reasons.map(describeMercadoPagoReason).join(", ")}).`}
        </p>
        {methods.map((method) => (
          <article aria-labelledby={`method-${method.method}`} className={styles.categoryCard} key={method.method}>
            <header className={styles.cardHeader}>
              <h3 id={`method-${method.method}`}>{METHOD_LABEL[method.method]}</h3>
              <span className={method.enabled ? styles.badge : styles.badgeMuted}>{method.enabled ? "Habilitado" : "Deshabilitado"}</span>
            </header>
            <AdminForm action={savePaymentMethodAction} submitLabel={`Guardar ${METHOD_LABEL[method.method]}`}>
              <input name="method" type="hidden" value={method.method} />
              <CheckboxField defaultChecked={method.enabled} label="Habilitado" name="enabled" />
              <TextField defaultValue={method.displayName} label="Nombre visible" maxLength={60} name="displayName" required />
              <TextAreaField
                defaultValue={method.instructions}
                hint="Texto público para el cliente (por ejemplo alias o CBU para transferencias). No pongas claves ni tokens."
                label="Instrucciones"
                maxLength={500}
                name="instructions"
                rows={2}
              />
              <TextField defaultValue={String(method.sortOrder)} label="Orden" max={1000} min={0} name="sortOrder" type="number" />
            </AdminForm>
          </article>
        ))}
      </section>

      <section aria-labelledby="public-title" className={styles.tabPanel}>
        <h2 id="public-title">Lo que ve el cliente</h2>
        <dl className={styles.publicView}>
          <dt>Estado</dt>
          <dd>
            <PublicStatusText status={publicStatus} />
          </dd>
          <dt>Delivery</dt>
          <dd>{store.deliveryFeeCents === null ? "Sin tarifa configurada" : formatArs(store.deliveryFeeCents)}</dd>
          <dt>WhatsApp</dt>
          <dd>{store.whatsappE164}</dd>
          <dt>Medios de pago</dt>
          <dd>
            {enabledMethods.length === 0 ? (
              "Ninguno habilitado"
            ) : (
              <ul>
                {enabledMethods.map((method) => (
                  <li key={method.method}>
                    <strong>{method.displayName}</strong>
                    {method.instructions ? ` — ${method.instructions}` : null}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
        <p className={styles.hint}>Las credenciales de Mercado Pago y de Supabase nunca se muestran ni se envían al navegador.</p>
      </section>
    </section>
  );
}

function describeMercadoPagoReason(reason: string) {
  return (
    {
      config: "falta configurarlo en el servidor",
      payment_method_disabled: "está deshabilitado acá",
      persistence: "falta la persistencia de pagos en el servidor",
      rate_limit_backend: "falta el límite de uso en el servidor"
    }[reason] ?? "no disponible"
  );
}

function ShiftList({ shifts }: { shifts: StoredShift[] }) {
  return (
    <ol aria-label="Turnos" className={styles.orderList}>
      {shifts.map((shift) => (
        <li key={shift.id}>
          <span>
            <strong>{WEEKDAYS[shift.dayOfWeek]}</strong> {shift.opensAt} a {shift.closesAt}
            {shift.closesAt <= shift.opensAt ? <span className={styles.badgeMuted}>Cruza medianoche</span> : null}
          </span>
          <AdminForm
            action={deleteShiftAction}
            className={styles.inlineForm}
            pendingLabel="…"
            submitAriaLabel={`Eliminar turno del ${WEEKDAYS[shift.dayOfWeek]} ${shift.opensAt}`}
            submitLabel="✕"
            submitVariant="icon"
          >
            <input name="shiftId" type="hidden" value={shift.id} />
          </AdminForm>
        </li>
      ))}
    </ol>
  );
}
