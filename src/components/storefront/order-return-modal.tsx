"use client";

import { CheckCircle2, Clock, AlertCircle, MessageCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatArs } from "@/lib/money";

export interface OrderReturnModalProps {
  externalReference: string;
  paymentId?: string | null;
  onClose: () => void;
  onApproved?: () => void;
}

export type ReturnVerificationState =
  | { status: "checking"; attempt: number }
  | { status: "approved"; paymentReference: string; whatsappUrl: string | null; totalCents: string }
  | { status: "pending"; message: string }
  | { status: "rejected"; message: string }
  | { status: "expired"; message: string }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 12;

export function OrderReturnModal({
  externalReference,
  paymentId,
  onClose,
  onApproved
}: OrderReturnModalProps) {
  const [state, setState] = useState<ReturnVerificationState>({
    status: "checking",
    attempt: 1
  });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onApprovedRef = useRef(onApproved);
  useEffect(() => {
    onApprovedRef.current = onApproved;
  }, [onApproved]);

  const notifiedApprovedRef = useRef<string | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let attemptCount = 0;
    let timer: number | null = null;
    let cancelled = false;

    const checkStatus = async () => {
      attemptCount += 1;
      try {
        const query = new URLSearchParams({ ref: externalReference });
        if (paymentId) query.set("payment_id", paymentId);

        const res = await fetch(`/api/checkout/mercado-pago/status?${query.toString()}`, {
          cache: "no-store"
        });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          if (data.status === "approved") {
            setState({
              status: "approved",
              paymentReference: data.paymentReference,
              whatsappUrl: data.whatsappUrl ?? null,
              totalCents: data.totalCents ?? "0"
            });
            if (notifiedApprovedRef.current !== externalReference) {
              notifiedApprovedRef.current = externalReference;
              onApprovedRef.current?.();
            }
            return;
          }

          if (data.status === "rejected" || data.status === "cancelled") {
            setState({
              status: "rejected",
              message: data.message || "El pago fue rechazado por la pasarela o cancelado."
            });
            return;
          }

          if (data.status === "expired") {
            setState({
              status: "expired",
              message: "El tiempo para completar este pago ha vencido. Podés iniciar un nuevo pedido."
            });
            return;
          }

          if (data.status === "pending" && attemptCount >= MAX_ATTEMPTS) {
            setState({
              status: "pending",
              message: "El pago continúa en proceso de acreditación. Si abonaste por ventanilla, puede demorar hasta 24 hs."
            });
            return;
          }
        }
      } catch {
        if (cancelled) return;
      }

      if (attemptCount < MAX_ATTEMPTS) {
        setState({ status: "checking", attempt: attemptCount + 1 });
        timer = window.setTimeout(checkStatus, POLL_INTERVAL_MS);
      } else {
        setState({
          status: "pending",
          message: "No pudimos confirmar la acreditación automática en tiempo real. Tu carrito continúa guardado."
        });
      }
    };

    checkStatus();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [externalReference, paymentId]);

  return (
    <div
      className="return-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-modal-title"
      data-testid="order-return-modal"
    >
      <div className="return-modal-card">
        <button
          ref={closeButtonRef}
          onClick={onClose}
          type="button"
          aria-label="Cerrar ventana de estado"
          className="return-modal-close"
        >
          <X size={20} />
        </button>

        {state.status === "checking" && (
          <div aria-live="polite" className="return-modal-body" role="status">
            <div className="return-modal-icon icon-spin">
              <RefreshCw size={48} className="animate-spin" />
            </div>
            <h2 className="return-modal-title" id="return-modal-title">
              Verificando tu pago
            </h2>
            <p className="return-modal-desc">
              Estamos confirmando la acreditación con Mercado Pago y el local. Por favor, aguardá unos segundos…
            </p>
            <small className="return-modal-ref">Ref: {externalReference.slice(0, 8)}…</small>
          </div>
        )}

        {state.status === "approved" && (
          <div aria-live="assertive" className="return-modal-body" role="status">
            <div className="return-modal-icon icon-success">
              <CheckCircle2 size={54} />
            </div>
            <h2 className="return-modal-title" id="return-modal-title">
              ¡Pago acreditado con éxito!
            </h2>
            <p className="return-modal-desc">
              Tu pago de <strong>{formatArs(BigInt(state.totalCents))}</strong> ya fue confirmado por el sistema.
            </p>
            <div className="return-modal-instruction">
              <strong>Paso final:</strong>
              <span>
                Tocá el botón abajo para abrir WhatsApp y pasarle al local tu comprobante y coordinar la entrega.
              </span>
            </div>

            {state.whatsappUrl ? (
              <a
                href={state.whatsappUrl}
                className="whatsapp-button"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={20} />
                <span>Abrir WhatsApp y coordinar entrega</span>
              </a>
            ) : (
              <button className="primary-action wide" onClick={onClose} type="button">
                Aceptar
              </button>
            )}
          </div>
        )}

        {state.status === "pending" && (
          <div aria-live="polite" className="return-modal-body" role="status">
            <div className="return-modal-icon icon-pending">
              <Clock size={54} />
            </div>
            <h2 className="return-modal-title" id="return-modal-title">
              Pago en acreditación
            </h2>
            <p className="return-modal-desc">
              {state.message}
            </p>
            <button className="primary-action wide" onClick={onClose} type="button">
              Entendido, volver a la carta
            </button>
          </div>
        )}

        {(state.status === "rejected" || state.status === "expired" || state.status === "error") && (
          <div aria-live="assertive" className="return-modal-body" role="alert">
            <div className="return-modal-icon icon-danger">
              <AlertCircle size={54} />
            </div>
            <h2 className="return-modal-title" id="return-modal-title">
              {state.status === "expired" ? "Pago expirado" : "No pudimos procesar el pago"}
            </h2>
            <p className="return-modal-desc">
              {state.message}
            </p>
            <p className="return-modal-desc">
              Tu carrito está intacto. Podés volver a intentar con otra tarjeta o elegir abonar por transferencia / efectivo.
            </p>
            <div className="return-modal-actions">
              <button className="primary-action wide" onClick={onClose} type="button">
                Volver al carrito
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
