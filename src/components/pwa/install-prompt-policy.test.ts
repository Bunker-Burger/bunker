import { describe, expect, it } from "vitest";
import { DISMISS_FOR_MS, DISMISS_KEY, dismissedRecently, installSuggestion, isIos, rememberDismissal, type BrowserTraits } from "./install-prompt-policy";

const ANDROID: BrowserTraits = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130", platform: "Linux armv8l", maxTouchPoints: 5, displayModeStandalone: false };
const IPHONE: BrowserTraits = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", platform: "iPhone", maxTouchPoints: 5, displayModeStandalone: false };
const IPAD: BrowserTraits = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5, displayModeStandalone: false };
const MAC: BrowserTraits = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0, displayModeStandalone: false };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

describe("installSuggestion", () => {
  it("waits for an interaction before suggesting anything", () => {
    expect(installSuggestion({ engaged: false, traits: ANDROID, canPrompt: true, dismissed: false })).toBeNull();
    expect(installSuggestion({ engaged: true, traits: ANDROID, canPrompt: true, dismissed: false })).toBe("prompt");
  });

  it("gives iOS the Share → Agregar a inicio steps, since it has no install prompt", () => {
    expect(installSuggestion({ engaged: true, traits: IPHONE, canPrompt: false, dismissed: false })).toBe("ios-instructions");
    expect(installSuggestion({ engaged: true, traits: IPAD, canPrompt: false, dismissed: false })).toBe("ios-instructions");
  });

  it("says nothing where the browser cannot install and is not iOS", () => {
    expect(installSuggestion({ engaged: true, traits: MAC, canPrompt: false, dismissed: false })).toBeNull();
  });

  it.each([
    ["already installed (display mode)", { ...ANDROID, displayModeStandalone: true }, true],
    ["already on the iOS home screen", { ...IPHONE, standalone: true }, false]
  ])("never suggests installing when %s", (_case, traits, canPrompt) => {
    expect(installSuggestion({ engaged: true, traits, canPrompt, dismissed: false })).toBeNull();
  });

  it("respects a recent dismissal", () => {
    expect(installSuggestion({ engaged: true, traits: ANDROID, canPrompt: true, dismissed: true })).toBeNull();
  });
});

describe("dismissal memory", () => {
  it("lasts 30 days", () => {
    const storage = memoryStorage();
    rememberDismissal(storage, 1_000);
    expect(storage.data.get(DISMISS_KEY)).toBe("1000");
    expect(dismissedRecently(storage, 1_000 + DISMISS_FOR_MS - 1)).toBe(true);
    expect(dismissedRecently(storage, 1_000 + DISMISS_FOR_MS)).toBe(false);
  });

  it("treats missing, corrupt or blocked storage as not dismissed, without throwing", () => {
    expect(dismissedRecently(memoryStorage(), 5)).toBe(false);
    expect(dismissedRecently(memoryStorage({ [DISMISS_KEY]: "garbage" }), 5)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      }
    };
    expect(dismissedRecently(blocked, 5)).toBe(false);
    expect(() => rememberDismissal(blocked, 5)).not.toThrow();
    expect(dismissedRecently(undefined, 5)).toBe(false);
  });
});

describe("isIos", () => {
  it("recognizes iPhone and iPadOS (which reports a Mac with touch), not a Mac", () => {
    expect(isIos(IPHONE)).toBe(true);
    expect(isIos(IPAD)).toBe(true);
    expect(isIos(MAC)).toBe(false);
    expect(isIos(ANDROID)).toBe(false);
  });
});
