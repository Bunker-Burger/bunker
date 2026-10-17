import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatArs } from "@/lib/money";
import { CompareAt } from "./compare-at";

describe("CompareAt", () => {
  it("strikes the price with a screen-reader prefix and the default class", () => {
    const { container } = render(<CompareAt cents={150000n} />);
    const struck = container.querySelector("s");
    expect(struck?.className).toBe("compare-at");
    expect(struck?.querySelector(".sr-only")?.textContent).toBe("Antes");
    expect(struck?.textContent).toBe(`Antes ${formatArs(150000n)}`);
  });

  it("renders only the price when the prefix is off", () => {
    const { container } = render(<CompareAt cents={150000n} srLabel={false} />);
    const struck = container.querySelector("s");
    expect(struck?.querySelector(".sr-only")).toBeNull();
    expect(struck?.textContent).toBe(formatArs(150000n));
  });

  it("leaves out the class attribute when it is empty", () => {
    const { container } = render(<CompareAt className="" cents={150000n} />);
    expect(container.querySelector("s")?.hasAttribute("class")).toBe(false);
  });
});
