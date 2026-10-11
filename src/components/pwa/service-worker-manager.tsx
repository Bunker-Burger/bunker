"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/sonner";
import { registerServiceWorker, type WorkerContainer } from "./service-worker-updates";

const UPDATE_TOAST = "sw-update";

/** Registers the worker in production builds and asks before switching to a new version. */
export function ServiceWorkerManager() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    registerServiceWorker(navigator.serviceWorker as unknown as WorkerContainer, {
      onUpdateReady(apply) {
        toast("Hay una versión nueva de la carta.", {
          id: UPDATE_TOAST,
          description: "Actualizá para ver los últimos cambios. Tu carrito queda guardado.",
          position: "bottom-center",
          duration: Number.POSITIVE_INFINITY,
          action: { label: "Actualizar", onClick: apply }
        });
      },
      onControllerChange(acceptedHere) {
        if (acceptedHere) {
          window.location.reload();
          return;
        }
        // Another tab updated: this page still runs the previous build, so offer a reload.
        toast("La carta se actualizó.", {
          id: UPDATE_TOAST,
          description: "Recargá para seguir con la versión nueva. Tu carrito queda guardado.",
          position: "bottom-center",
          duration: Number.POSITIVE_INFINITY,
          action: { label: "Recargar", onClick: () => window.location.reload() }
        });
      }
    }).catch(() => {
      // No worker (private mode, blocked): the site keeps working online.
    });
  }, []);
  return null;
}
