import { act, render, screen } from "@testing-library/react";
import { Home, ShoppingBag } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell, SiteHeader } from "./app-shell";
import { BottomNav } from "./bottom-nav";
import { createActiveSectionStore } from "./use-active-section";
import { isTextEntry } from "./use-virtual-keyboard";

const items = [
  { href: "#menu", label: "Menú", icon: Home },
  { href: "#carrito", label: "Carrito", icon: ShoppingBag, badge: 2 }
];

function mockPointer(coarse: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  }));
}

afterEach(() => vi.restoreAllMocks());

describe("AppShell", () => {
  it("offers a skip link to the main landmark", () => {
    render(<AppShell header={<SiteHeader>Búnker</SiteHeader>}>Contenido</AppShell>);
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute("href", "#contenido");
    expect(screen.getByRole("main")).toHaveAttribute("id", "contenido");
    expect(screen.getByRole("banner")).toHaveTextContent("Búnker");
  });
});

describe("BottomNav", () => {
  it("marks the active in-page anchor as the current location and announces badges", () => {
    render(<BottomNav activeHref="#menu" items={items} />);
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(screen.getByRole("link", { name: "Menú" })).toHaveAttribute("aria-current", "location");
    const cartLink = screen.getByRole("link", { name: /^Carrito/ });
    expect(cartLink).toHaveAccessibleName(/^Carrito\s*\(2\)$/);
    expect(cartLink).not.toHaveAttribute("aria-current");
    expect(nav).toBeVisible();
  });

  it("hides while a touch keyboard is editing text", async () => {
    mockPointer(true);
    render(
      <>
        <input aria-label="Nombre" />
        <BottomNav activeHref="#menu" items={items} />
      </>
    );
    act(() => screen.getByRole("textbox", { name: "Nombre" }).focus());
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole("textbox", { hidden: true }).blur();
      await Promise.resolve();
    });
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeVisible();
  });

  it("stays visible on desktop pointers while typing", () => {
    mockPointer(false);
    render(
      <>
        <input aria-label="Nombre" />
        <BottomNav activeHref="#menu" items={items} />
      </>
    );
    act(() => screen.getByRole("textbox", { name: "Nombre" }).focus());
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeVisible();
  });

  it("marks a real route as the current page", () => {
    render(<BottomNav activeHref="/bunker" items={[...items, { href: "/bunker", label: "Admin", icon: Home }]} />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Menú" })).not.toHaveAttribute("aria-current");
  });
});

describe("createActiveSectionStore", () => {
  it("follows link activation and back/forward, and removes its listeners when unused", () => {
    document.body.innerHTML = '<a href="#carrito">Carrito</a><section id="menu"></section><section id="carrito"></section>';
    const store = createActiveSectionStore(["menu", "carrito"]);
    const listener = vi.fn();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    expect(store.getServerSnapshot()).toBe("menu");
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot()).toBe("menu");

    document.querySelector("a")?.click();
    expect(store.getSnapshot()).toBe("carrito");
    expect(listener).toHaveBeenCalledTimes(1);

    window.location.hash = "#menu";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(store.getSnapshot()).toBe("menu");

    // Back to the original URL removes the hash; the first section must become current again.
    window.history.replaceState({}, "", "#carrito");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(store.getSnapshot()).toBe("carrito");
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(store.getSnapshot()).toBe("menu");

    unsubscribe();
    expect(removeSpy.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["hashchange", "scroll", "wheel", "touchmove", "keydown"])
    );
    window.location.hash = "";
    document.body.innerHTML = "";
  });
});

describe("isTextEntry", () => {
  it("only treats editable text controls as keyboard triggers", () => {
    const make = (html: string) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      return wrapper.firstElementChild;
    };
    expect(isTextEntry(make('<input type="text">'))).toBe(true);
    expect(isTextEntry(make('<input type="email">'))).toBe(true);
    expect(isTextEntry(make("<textarea></textarea>"))).toBe(true);
    expect(isTextEntry(make('<input type="radio">'))).toBe(false);
    expect(isTextEntry(make('<input type="text" readonly>'))).toBe(false);
    expect(isTextEntry(make("<button>Ok</button>"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
