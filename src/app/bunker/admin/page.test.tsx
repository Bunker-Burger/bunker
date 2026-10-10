import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AdminHomePage from "./page";

describe("/bunker/admin", () => {
  it("links to the catalog and the public menu without invented metrics", () => {
    render(<AdminHomePage />);

    expect(screen.getByRole("heading", { name: "Panel administrativo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Administrar catálogo" })).toHaveAttribute("href", "/bunker/admin/catalogo");
    expect(screen.getByRole("link", { name: "Ver menú público" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/pedidos|clientes|factura|ventas|ingresos|kpi/i)).not.toBeInTheDocument();
  });
});
