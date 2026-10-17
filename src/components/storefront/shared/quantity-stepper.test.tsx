import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuantityStepper } from "./quantity-stepper";

function setup(props: Partial<Parameters<typeof QuantityStepper>[0]> = {}) {
  const onDecrement = vi.fn();
  const onIncrement = vi.fn();
  const view = render(
    <QuantityStepper decrementLabel="Menos" incrementLabel="Más" onDecrement={onDecrement} onIncrement={onIncrement} value={3} {...props} />
  );
  return { onDecrement, onIncrement, ...view };
}

describe("QuantityStepper", () => {
  it("shows the value", () => {
    setup();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("calls the callbacks of each button", () => {
    const { onDecrement, onIncrement } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Menos" }));
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    expect(onDecrement).toHaveBeenCalledTimes(1);
    expect(onIncrement).toHaveBeenCalledTimes(1);
  });

  it("disables only the decrement button", () => {
    setup({ decrementDisabled: true });
    expect((screen.getByRole("button", { name: "Menos" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Más" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds the compact class", () => {
    const { container } = setup({ compact: true });
    expect(container.firstElementChild?.className).toBe("quantity-stepper compact");
  });

  it("is not compact by default and has no label on the count", () => {
    const { container } = setup();
    expect(container.firstElementChild?.className).toBe("quantity-stepper");
    expect(container.querySelector("strong")?.hasAttribute("aria-label")).toBe(false);
  });

  it("labels the count when asked", () => {
    setup({ valueLabel: "3 combos" });
    expect(screen.getByLabelText("3 combos").textContent).toBe("3");
  });
});
