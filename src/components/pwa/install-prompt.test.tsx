import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/sonner";
import { InstallPrompt } from "./install-prompt";
import { DISMISS_KEY } from "./install-prompt-policy";

vi.mock("@/components/ui/sonner", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }));

const toastMock = vi.mocked(toast);
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";

function useBrowser(userAgent: string, standalone = false) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(userAgent.includes("iPhone") ? "iPhone" : "Linux armv8l");
  window.matchMedia = vi.fn().mockReturnValue({ matches: standalone }) as unknown as typeof window.matchMedia;
}

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

beforeEach(() => {
  localStorage.clear();
  toastMock.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("InstallPrompt", () => {
  it("keeps the browser's own banner away and says nothing until the person adds a product", () => {
    useBrowser(ANDROID_UA);
    const { rerender } = render(<InstallPrompt engaged={false} />);
    const event = installEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();

    rerender(<InstallPrompt engaged />);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]![0]).toBe("Instalá Búnker Burger");
  });

  it("opens the browser's install dialog from the action and remembers a refusal", async () => {
    useBrowser(ANDROID_UA);
    render(<InstallPrompt engaged />);
    const event = installEvent("dismissed");
    act(() => {
      window.dispatchEvent(event);
    });
    const options = toastMock.mock.calls[0]![1] as unknown as { action: { onClick: () => Promise<void> } };
    await act(() => options.action.onClick());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DISMISS_KEY)).not.toBeNull();
  });

  it("shows the Safari steps on iPhone, once per visit", () => {
    useBrowser(IPHONE_UA);
    const { rerender } = render(<InstallPrompt engaged />);
    rerender(<InstallPrompt engaged />);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]![0]).toBe("Agregá Búnker Burger a tu inicio");
    expect(toastMock.mock.calls[0]![1]).toMatchObject({ description: "En Safari tocá Compartir y elegí «Agregar a inicio»." });
  });

  it("stays quiet when already installed or recently dismissed", () => {
    useBrowser(IPHONE_UA, true);
    render(<InstallPrompt engaged />);
    expect(toastMock).not.toHaveBeenCalled();

    useBrowser(IPHONE_UA);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    render(<InstallPrompt engaged />);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
