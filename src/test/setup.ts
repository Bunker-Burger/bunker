import "@testing-library/jest-dom/vitest";

// Files that opt into `@vitest-environment node` (real File/FormData) have no DOM to patch.
const hasDom = typeof window !== "undefined";

// jsdom has no matchMedia; default every query to "no match" (desktop, fine pointer).
if (hasDom && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  });
}

// jsdom does not lay out, so scrolling is a no-op there.
if (hasDom && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
