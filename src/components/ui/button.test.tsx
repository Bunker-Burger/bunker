import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders a native button with variant classes", () => {
    render(<Button variant="outline">Ver menú</Button>);
    const button = screen.getByRole("button", { name: "Ver menú" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button.className).toContain("border");
  });

  it("can render its child element instead of a button", () => {
    render(<Button asChild><a href="#menu">Ir al menú</a></Button>);
    expect(screen.getByRole("link", { name: "Ir al menú" })).toHaveAttribute("href", "#menu");
  });
});
