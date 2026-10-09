import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AdminHomePage from "./page";

describe("/bunker/admin", () => {
  it("renders a minimal landing without catalog-management controls", () => {
    render(<AdminHomePage />);

    expect(screen.getByRole("heading", { name: "Panel administrativo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver menú público" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: /agregar producto/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/pedidos|clientes|facturas/i)).not.toBeInTheDocument();
  });
});
