"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";

/** Back from WhatsApp: the customer says whether the order went out, and only then the cart is emptied. */
export function OrderSentPrompt({ onSent, onKeep }: { onSent: () => void; onKeep: () => void }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef(onKeep);
  useEffect(() => {
    keepRef.current = onKeep;
  });

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") keepRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div aria-describedby="order-sent-desc" aria-labelledby="order-sent-title" aria-modal="true" className="return-modal-backdrop" role="alertdialog">
      <div className="return-modal-card">
        <div className="return-modal-body">
          <div className="return-modal-icon icon-success">
            <MessageCircle aria-hidden="true" size={44} />
          </div>
          <h2 className="return-modal-title" id="order-sent-title">
            ¿Enviaste tu pedido?
          </h2>
          <p className="return-modal-desc" id="order-sent-desc">
            Si ya mandaste el mensaje por WhatsApp, vaciamos el carrito. Si te faltó algo, lo dejamos como estaba.
          </p>
          <div className="return-modal-actions order-sent-actions">
            <button className="primary-action wide" onClick={onSent} ref={firstRef} type="button">
              Sí, vaciar carrito
            </button>
            <button className="secondary-action wide" onClick={onKeep} type="button">
              No, seguir con mi pedido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
