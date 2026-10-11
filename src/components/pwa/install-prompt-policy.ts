/*
 * When to suggest installing the menu (BB-16): only after the person did something meaningful
 * (added a product), never when it already runs installed, and not again for a while once they
 * dismissed it. iOS has no install prompt, so it gets the Share → "Agregar a inicio" steps.
 */

export const DISMISS_KEY = "bunker.install-prompt.dismissed-at";
export const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

export interface BrowserTraits {
  userAgent: string;
  platform?: string | undefined;
  maxTouchPoints?: number | undefined;
  /** Safari on iOS sets `navigator.standalone` when opened from the home screen. */
  standalone?: boolean | undefined;
  /** `matchMedia("(display-mode: standalone)").matches`. */
  displayModeStandalone: boolean;
}

export function isIos({ userAgent, platform, maxTouchPoints }: BrowserTraits) {
  // iPadOS reports itself as a Mac; a Mac does not have a touch screen.
  return /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && (maxTouchPoints ?? 0) > 1);
}

export function isInstalled(traits: BrowserTraits) {
  return traits.displayModeStandalone || traits.standalone === true;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function dismissedRecently(storage: Storage | undefined, now: number) {
  try {
    const at = Number(storage?.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

export function rememberDismissal(storage: Storage | undefined, now: number) {
  try {
    storage?.setItem(DISMISS_KEY, String(now));
  } catch {
    // Storage blocked: the suggestion may come back next visit, nothing else breaks.
  }
}

export type InstallSuggestion = "prompt" | "ios-instructions" | null;

export function installSuggestion({
  engaged,
  traits,
  canPrompt,
  dismissed
}: {
  engaged: boolean;
  traits: BrowserTraits;
  /** The browser fired `beforeinstallprompt` and the event was kept. */
  canPrompt: boolean;
  dismissed: boolean;
}): InstallSuggestion {
  if (!engaged || dismissed || isInstalled(traits)) return null;
  if (canPrompt) return "prompt";
  return isIos(traits) ? "ios-instructions" : null;
}
