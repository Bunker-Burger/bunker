import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins conditional classes and lets later Tailwind utilities win", () => {
    expect(cn("px-2 py-1", false && "hidden", "px-4")).toBe("py-1 px-4");
  });

  it("keeps a token text color next to a token font size", () => {
    expect(cn("text-on-primary", "text-label")).toBe("text-on-primary text-label");
    expect(cn("text-body", "text-badge")).toBe("text-badge");
    expect(cn("text-muted", "text-primary")).toBe("text-primary");
  });

  it("merges token radii, shadows and spacing", () => {
    expect(cn("rounded-md", "rounded-xl")).toBe("rounded-xl");
    expect(cn("shadow-glow", "shadow-overlay")).toBe("shadow-overlay");
    expect(cn("min-h-12", "min-h-tap")).toBe("min-h-tap");
  });
});
