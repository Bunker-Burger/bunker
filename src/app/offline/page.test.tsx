import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage, { dynamic } from "./page";

describe("/offline", () => {
  it("explains the state and that nothing is sent or charged offline, with a way back to the menu", () => {
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sin conexión" })).toBeInTheDocument();
    expect(screen.getByText(/sin conexión no se envía ni se cobra nada/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a la carta" })).toHaveAttribute("href", "/");
  });

  it("is a static public page (it is precached once per build)", () => {
    expect(dynamic).toBe("force-static");
    const { container } = render(<OfflinePage />);
    expect(container.textContent).not.toMatch(/\$|admin|carrito|total/i);
  });
});
