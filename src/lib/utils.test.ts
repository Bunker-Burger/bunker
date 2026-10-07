import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins conditional classes and lets later Tailwind utilities win", () => {
    expect(cn("px-2 py-1", false && "hidden", "px-4")).toBe("py-1 px-4");
  });
});
