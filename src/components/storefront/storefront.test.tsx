import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Storefront } from "./storefront";

describe("Storefront", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("filters the visible menu and keeps sold-out products visible", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Papas" }));

    expect(screen.getByRole("heading", { name: "Papas Búnker" })).toBeInTheDocument();
    expect(screen.getByText("Agotado")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Smash Búnker Doble" })).not.toBeInTheDocument();
  });

  it("adds product defaults directly to the persisted cart", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));

    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
    expect(localStorage.getItem("bunker-cart")).toContain("smash-doble");
  });

  it("opens a configured product and adds edited quantity, notes and options", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug="smash-bunker-doble" mercadoPagoEnabled={false} />);

    const dialog = screen.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await user.click(within(dialog).getByRole("radio", { name: /Triple/ }));
    await user.click(within(dialog).getByRole("button", { name: "Aumentar cantidad" }));
    await user.type(within(dialog).getByLabelText("Aclaraciones para la cocina"), "Sin cebolla");
    await user.click(within(dialog).getByRole("button", { name: /Agregar 2 al carrito/ }));

    expect(screen.getByLabelText("Carrito, 2 productos")).toBeInTheDocument();
    const persisted = localStorage.getItem("bunker-cart");
    expect(persisted).toContain("triple");
    expect(persisted).toContain("Sin cebolla");
  });

  it("announces an invalid slug and requests URL cleanup", () => {
    const onInvalidProduct = vi.fn();
    render(
      <Storefront
        initialProductSlug="producto-inexistente"
        mercadoPagoEnabled={false}
        onInvalidProduct={onInvalidProduct}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Ese producto ya no está disponible");
    expect(onInvalidProduct).toHaveBeenCalledOnce();
  });

  it("only shows Mercado Pago when the public capability is enabled", () => {
    const { rerender } = render(
      <Storefront initialProductSlug={null} mercadoPagoEnabled={false} />
    );
    expect(screen.queryByRole("radio", { name: /Mercado Pago/ })).not.toBeInTheDocument();

    rerender(<Storefront initialProductSlug={null} mercadoPagoEnabled />);
    expect(screen.getByRole("radio", { name: /Mercado Pago/ })).toBeInTheDocument();
  });
});
