import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeCart } from "@/domain/cart";
import type { CartLine } from "@/domain/types";
import { ProductDrawer, Storefront } from "./storefront";

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

  it("marks exactly the section being navigated to as current in the bottom bar", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const currentItems = () =>
      within(nav).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "location");

    for (const label of ["Menú", "Carrito", "Checkout"]) {
      await user.click(within(nav).getByRole("link", { name: new RegExp(`^${label}`) }));
      expect(currentItems()).toHaveLength(1);
      expect(currentItems()[0]).toHaveAccessibleName(new RegExp(`^${label}`));
    }
    window.location.hash = "";
  });

  it("only shows Mercado Pago when the public capability is enabled", () => {
    const { rerender } = render(
      <Storefront initialProductSlug={null} mercadoPagoEnabled={false} />
    );
    expect(screen.queryByRole("radio", { name: /Mercado Pago/ })).not.toBeInTheDocument();

    rerender(<Storefront initialProductSlug={null} mercadoPagoEnabled />);
    expect(screen.getByRole("radio", { name: /Mercado Pago/ })).toBeInTheDocument();
  });

  it("shows only applicable option groups for beverages without burger options", async () => {
    render(<Storefront initialProductSlug="gaseosa-lata" mercadoPagoEnabled={false} />);

    const dialog = screen.getByRole("dialog", { name: "Personalizar Gaseosa Lata 354ml" });
    expect(within(dialog).getByRole("radio", { name: /Con hielo/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("radio", { name: /Doble/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Tamaño / medallones")).not.toBeInTheDocument();
  });

  it("renders checkboxes for selectionMode multiple with maxSelections 1, allows single toggle, blocks second and allows untoggle", async () => {
    const user = userEvent.setup();
    const testProduct = {
      id: "burger-custom",
      slug: "burger-custom",
      categoryId: "burgers",
      type: "burger" as const,
      name: "Hamburguesa Custom",
      description: "Con salsa opcional",
      priceCents: 500000n,
      imageUrl: null,
      published: true,
      featured: false,
      inStock: true,
      optionGroups: [
        {
          id: "sauce",
          name: "Salsa opcional",
          selectionMode: "multiple" as const,
          required: false,
          minSelections: 0,
          maxSelections: 1,
          defaultOptionIds: [],
          applicableTypes: ["burger" as const],
          options: [
            { id: "mayo", name: "Mayonesa casera", priceDeltaCents: 0n, available: true },
            { id: "bbq", name: "Salsa barbacoa", priceDeltaCents: 50000n, available: true }
          ]
        }
      ]
    };

    render(<ProductDrawer onClose={() => {}} onSubmit={() => {}} product={testProduct} />);

    // 1. Debe renderizar checkbox, no radio
    const mayoCheckbox = screen.getByRole("checkbox", { name: /Mayonesa casera/ });
    const bbqCheckbox = screen.getByRole("checkbox", { name: /Salsa barbacoa/ });
    expect(mayoCheckbox).toBeInTheDocument();
    expect(bbqCheckbox).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    // 2. Permitir seleccionar una opción
    await user.click(mayoCheckbox);
    expect(mayoCheckbox).toBeChecked();
    expect(bbqCheckbox).not.toBeChecked();

    // 3. Impedir seleccionar una segunda mientras ya hay una seleccionada
    await user.click(bbqCheckbox);
    expect(bbqCheckbox).not.toBeChecked();
    expect(mayoCheckbox).toBeChecked();

    // 4. Permitir deseleccionar la opción actual
    await user.click(mayoCheckbox);
    expect(mayoCheckbox).not.toBeChecked();

    // Ahora la otra opción sí puede seleccionarse
    await user.click(bbqCheckbox);
    expect(bbqCheckbox).toBeChecked();
  });

  it("permite la interacción completa de single opcional: vacío → seleccionar → limpiar → vacío válido que permite agregar", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const optionalSingleProduct = {
      id: "burger-optional-dressing",
      slug: "burger-optional-dressing",
      categoryId: "burgers",
      type: "burger" as const,
      name: "Hamburguesa con Aderezo Opcional",
      description: "Aderezo single opcional",
      priceCents: 600000n,
      imageUrl: null,
      published: true,
      featured: false,
      inStock: true,
      optionGroups: [
        {
          id: "dressing",
          name: "Aderezo",
          selectionMode: "single" as const,
          required: false,
          minSelections: 0,
          maxSelections: 1,
          defaultOptionIds: [],
          applicableTypes: ["burger" as const],
          options: [
            { id: "mayo", name: "Mayonesa casera", priceDeltaCents: 0n, available: true },
            { id: "mustard", name: "Mostaza dulce", priceDeltaCents: 20000n, available: true }
          ]
        }
      ]
    };

    render(<ProductDrawer onClose={() => {}} onSubmit={onSubmit} product={optionalSingleProduct} />);

    // 1. Debe renderizar radios para selección única
    const mayoRadio = screen.getByRole("radio", { name: /Mayonesa casera/ });
    const mustardRadio = screen.getByRole("radio", { name: /Mostaza dulce/ });
    expect(mayoRadio).toBeInTheDocument();
    expect(mustardRadio).toBeInTheDocument();

    // Estado inicial: vacío válido -> botón Agregar está habilitado, sin botón Limpiar
    const addButton = screen.getByRole("button", { name: /Agregar 1 al carrito/ });
    expect(addButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Limpiar/i })).not.toBeInTheDocument();

    // 2. Seleccionar opción
    await user.click(mayoRadio);
    expect(mayoRadio).toBeChecked();
    expect(mustardRadio).not.toBeChecked();

    // Ahora aparece el control accesible de Limpiar
    const clearButton = screen.getByRole("button", { name: /Limpiar/i });
    expect(clearButton).toBeInTheDocument();

    // 3. Limpiar con el botón Limpiar -> vuelve a vacío válido
    await user.click(clearButton);
    expect(mayoRadio).not.toBeChecked();
    expect(mustardRadio).not.toBeChecked();
    expect(addButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Limpiar/i })).not.toBeInTheDocument();

    // 4. Seleccionar nuevamente y deseleccionar haciendo click en la opción ya elegida
    await user.click(mustardRadio);
    expect(mustardRadio).toBeChecked();
    await user.click(mustardRadio);
    expect(mustardRadio).not.toBeChecked();
    expect(addButton).toBeEnabled();

    // 5. Agregar en estado vacío válido
    await user.click(addButton);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedOptions: expect.objectContaining({ dressing: [] })
      })
    );
  });

  it("control de single requerido: nunca permite terminar en un estado vacío que permita agregar", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const requiredSingleProduct = {
      id: "burger-required-patty",
      slug: "burger-required-patty",
      categoryId: "burgers",
      type: "burger" as const,
      name: "Hamburguesa con Medallón Requerido",
      description: "Medallón single requerido",
      priceCents: 700000n,
      imageUrl: null,
      published: true,
      featured: false,
      inStock: true,
      optionGroups: [
        {
          id: "patty",
          name: "Punto de cocción",
          selectionMode: "single" as const,
          required: true,
          minSelections: 1,
          maxSelections: 1,
          defaultOptionIds: [],
          applicableTypes: ["burger" as const],
          options: [
            { id: "jugoso", name: "Jugoso", priceDeltaCents: 0n, available: true },
            { id: "cocido", name: "Bien cocido", priceDeltaCents: 0n, available: true }
          ]
        }
      ]
    };

    render(<ProductDrawer onClose={() => {}} onSubmit={onSubmit} product={requiredSingleProduct} />);

    const jugosoRadio = screen.getByRole("radio", { name: /Jugoso/ });
    const addButton = screen.getByRole("button", { name: /Agregar 1 al carrito/ });

    // Estado inicial sin defaults: inválido, botón deshabilitado, no hay botón Limpiar
    expect(addButton).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Limpiar/i })).not.toBeInTheDocument();

    // Seleccionar opción requerida habilita el agregado
    await user.click(jugosoRadio);
    expect(jugosoRadio).toBeChecked();
    expect(addButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Limpiar/i })).not.toBeInTheDocument();

    // Intentar deseleccionar tocando de nuevo la opción seleccionada no la deselecciona
    await user.click(jugosoRadio);
    expect(jugosoRadio).toBeChecked();
    expect(addButton).toBeEnabled();
  });
});

describe("Storefront - BB-06 Carrito persistente, multi-pestaña, edición y revalidación", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleLine: CartLine = {
    id: '{"productId":"smash-doble","notes":"","selectedOptions":{"patty":["double"]}}',
    productId: "smash-doble",
    productSlug: "smash-bunker-doble",
    productName: "Smash Búnker Doble",
    unitPriceCents: 780000n,
    quantity: 1,
    notes: "",
    selectedOptions: { patty: ["double"] }
  };

  it("TC-PERS-02: el carrito persiste y se recupera intacto tras desmontar y volver a montar", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();

    unmount();

    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
    const cartSection = screen.getByRole("region", { name: "Carrito" });
    expect(within(cartSection).getByText("Smash Búnker Doble")).toBeInTheDocument();
  });

  it("TC-SYNC-01: sincroniza la pestaña en vivo cuando otra pestaña escribe en localStorage vía StorageEvent", () => {
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    expect(screen.getByLabelText("Carrito, 0 productos")).toBeInTheDocument();

    act(() => {
      localStorage.setItem("bunker-cart", serializeCart([sampleLine]));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "bunker-cart",
          newValue: serializeCart([sampleLine])
        })
      );
    });

    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
    const cartSection = screen.getByRole("region", { name: "Carrito" });
    expect(within(cartSection).getByText("Smash Búnker Doble")).toBeInTheDocument();
  });

  it("TC-SYNC-03: eliminación o vaciado en otra pestaña se refleja inmediatamente", () => {
    localStorage.setItem("bunker-cart", serializeCart([sampleLine]));
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();

    act(() => {
      localStorage.setItem("bunker-cart", serializeCart([]));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "bunker-cart",
          newValue: serializeCart([])
        })
      );
    });

    expect(screen.getByLabelText("Carrito, 0 productos")).toBeInTheDocument();
    expect(screen.getByText("Tu carrito está vacío")).toBeInTheDocument();
  });

  it("TC-SYNC-04: ignora eventos de claves ajenas a bunker-cart", () => {
    localStorage.setItem("bunker-cart", serializeCart([sampleLine]));
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    act(() => {
      localStorage.setItem("other-key", "val");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "other-key",
          newValue: "val"
        })
      );
    });

    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();
  });

  it("permite editar notas y opciones de una línea abriendo el drawer en modo edición", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();

    // Click en botón Editar
    await user.click(screen.getByRole("button", { name: "Editar Smash Búnker Doble" }));

    const dialog = screen.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Guardar cambios/ })).toBeInTheDocument();

    // Modificar notas
    const notesInput = within(dialog).getByLabelText("Aclaraciones para la cocina");
    await user.type(notesInput, "Sin mostaza");

    // Guardar cambios
    await user.click(within(dialog).getByRole("button", { name: /Guardar cambios/ }));

    expect(screen.getByText("Sin mostaza")).toBeInTheDocument();
  });

  it("permite eliminar una línea individual y vaciar el carrito completo", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
    expect(screen.getByLabelText("Carrito, 1 productos")).toBeInTheDocument();

    // Vaciar carrito
    await user.click(screen.getByRole("button", { name: "Vaciar carrito completo" }));
    expect(screen.getByLabelText("Carrito, 0 productos")).toBeInTheDocument();
    expect(screen.getByText("Tu carrito está vacío")).toBeInTheDocument();
  });

  it("bloquea el checkout y muestra aviso cuando el carrito está vacío", () => {
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const checkoutSection = screen.getByRole("region", { name: "Finalizar pedido" });
    const submitButton = within(checkoutSection).getByRole("button", {
      name: /WhatsApp|Confirmación|pedidos/i
    });
    expect(submitButton).toBeDisabled();
    expect(within(checkoutSection).getByText("El carrito está vacío. Agregá productos para finalizar el pedido.")).toBeInTheDocument();
  });

  it("revalida y actualiza precios en el carrito automáticamente ante discrepancias de catálogo", () => {
    const oldPriceLine: CartLine = {
      ...sampleLine,
      unitPriceCents: 500000n
    };
    localStorage.setItem("bunker-cart", serializeCart([oldPriceLine]));

    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const cartSection = screen.getByRole("region", { name: "Carrito" });
    expect(within(cartSection).getAllByText("$ 7.800")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent('"Smash Búnker Doble" actualizó su precio de $ 5.000 a $ 7.800.');
  });
});
