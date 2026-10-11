"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { dismissedRecently, installSuggestion, rememberDismissal, type BrowserTraits } from "./install-prompt-policy";

const INSTALL_TOAST = "install-app";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserTraits(): BrowserTraits {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone,
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false
  };
}

/**
 * A discreet suggestion to install the menu, shown once per visit after `engaged` turns true
 * (the person added a product). Dismissing it keeps it away for 30 days.
 */
export function InstallPrompt({ engaged }: { engaged: boolean }) {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    const keep = (event: Event) => {
      // Chrome would show its own mini-infobar right away; we wait for an interaction instead.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const installed = () => {
      deferred.current = null;
      setCanPrompt(false);
      toast.dismiss(INSTALL_TOAST);
    };
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    if (shown.current) return;
    const suggestion = installSuggestion({
      engaged,
      traits: browserTraits(),
      canPrompt,
      dismissed: dismissedRecently(storage(), Date.now())
    });
    if (!suggestion) return;
    shown.current = true;
    const dismiss = () => rememberDismissal(storage(), Date.now());
    if (suggestion === "prompt") {
      toast("Instalá Búnker Burger", {
        id: INSTALL_TOAST,
        description: "Abrí la carta desde tu pantalla de inicio, más rápido.",
        position: "bottom-center",
        duration: 15_000,
        action: {
          label: "Instalar",
          onClick: async () => {
            const event = deferred.current;
            deferred.current = null;
            setCanPrompt(false);
            if (!event) return;
            await event.prompt();
            if ((await event.userChoice).outcome === "dismissed") dismiss();
          }
        },
        onDismiss: dismiss
      });
    } else {
      toast("Agregá Búnker Burger a tu inicio", {
        id: INSTALL_TOAST,
        description: "En Safari tocá Compartir y elegí «Agregar a inicio».",
        position: "bottom-center",
        duration: 15_000,
        closeButton: true,
        onDismiss: dismiss
      });
    }
  }, [engaged, canPrompt]);

  return null;
}
