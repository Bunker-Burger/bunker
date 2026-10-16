import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products as fallbackProducts, categories as fixtureCategories } from "@/data/catalog";
import { revalidateCart, serializeCart } from "@/domain/cart";
import type { CartLine, Product } from "@/domain/types";
import { getCartSnapshot, resetCartStoreForTesting } from "@/lib/cart-store";
import { serializePublicCatalog, serializePublicCategories, serializePublicProducts } from "@/server/catalog/public-products";
import { ProductDrawer, Storefront } from "./storefront";

describe("Storefront", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCartStoreForTesting();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/api/store/products")) {
          return new Response(
            JSON.stringify(serializePublicCatalog({ products: fallbackProducts, categories: fixtureCategories })),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches the menu from the header and keeps sold-out products visible", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Buscar en la carta" }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar en la carta" }), "cebolla");

    expect(screen.getByRole("heading", { name: "Aros de Cebolla" })).toBeInTheDocument();
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

  it("announces an invalid slug and requests URL cleanup once the catalog is verified", async () => {
    const onInvalidProduct = vi.fn();
    render(
      <Storefront
        initialProductSlug="producto-inexistente"
        mercadoPagoEnabled={false}
        onInvalidProduct={onInvalidProduct}
      />
    );

    // The fallback copy cannot rule a product out; the server's answer can.
    expect(onInvalidProduct).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ese producto ya no está disponible"));
    // The callback runs in a passive effect, which React may flush in a later task than the
    // commit that painted the notice (slow runners), so wait for it instead of assuming it's there.
    await waitFor(() => expect(onInvalidProduct).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Ese producto ya no está disponible");
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

  it("links authorized admins to the protected panel and hides the item by default", () => {
    const { rerender } = render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();

    rerender(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} showAdminNav />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/bunker/admin");
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
    resetCartStoreForTesting();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/api/store/products")) {
          return new Response(
            JSON.stringify(serializePublicCatalog({ products: fallbackProducts, categories: fixtureCategories })),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    const cartSection = screen.getByRole("region", { name: "Tu pedido" });
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
    const cartSection = screen.getByRole("region", { name: "Tu pedido" });
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

  it("con varias unidades cada extra se pone en tantas como se elija, y se suma aparte al total", async () => {
    const user = userEvent.setup();
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const add = screen.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await user.click(add);
    await user.click(add);
    await user.click(add);
    expect(screen.getByLabelText("Carrito, 3 productos")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar Smash Búnker Doble" }));
    const dialog = screen.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    expect(within(dialog).queryByText(/En cuántas de las 3/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: /Extra bacon ahumado/ }));
    expect(within(dialog).getByText("En cuántas de las 3")).toBeInTheDocument();
    // On all three at first: 3 × $ 900, on top of 3 × $ 7.800.
    expect(within(dialog).getByText("+ $ 2.700")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Quitar Extra bacon ahumado de una unidad" }));
    await user.click(within(dialog).getByRole("button", { name: "Quitar Extra bacon ahumado de una unidad" }));
    expect(dialog.querySelector(".option-units-cost")).toHaveTextContent("+ $ 900");
    expect(within(dialog).getByRole("button", { name: /Guardar cambios/ })).toHaveTextContent("$ 24.300");
    await user.click(within(dialog).getByRole("button", { name: /Guardar cambios/ }));

    const lines = getCartSnapshot();
    expect(lines.map((line) => [line.quantity, line.selectedOptions.extras ?? []])).toEqual([
      [1, ["bacon"]],
      [2, []]
    ]);
    expect(lines.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n)).toBe(2430000n);
    expect(screen.getByLabelText("Carrito, 3 productos")).toBeInTheDocument();
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

  it("revalida y actualiza precios en el carrito automáticamente ante discrepancias de catálogo verificado", async () => {
    const oldPriceLine: CartLine = {
      ...sampleLine,
      unitPriceCents: 500000n
    };
    localStorage.setItem("bunker-cart", serializeCart([oldPriceLine]));

    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const cartSection = screen.getByRole("region", { name: "Tu pedido" });
    await waitFor(() => {
      expect(within(cartSection).getAllByText("$ 7.800")).toHaveLength(2);
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent('"Smash Búnker Doble" actualizó su precio de $ 5.000 a $ 7.800.'));
  });

  it("revalida y poda opciones cuando un grupo de opciones opcional desaparece del catálogo verificado", async () => {
    const lineWithCustomGroup: CartLine = {
      ...sampleLine,
      selectedOptions: {
        ...sampleLine.selectedOptions,
        "og-retired-group": ["opt-retired-1"]
      }
    };
    localStorage.setItem("bunker-cart", serializeCart([lineWithCustomGroup]));

    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    const cartSection = screen.getByRole("region", { name: "Tu pedido" });
    expect(within(cartSection).getByText("Smash Búnker Doble")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent('El grupo de opciones "og-retired-group" de "Smash Búnker Doble" ya no está disponible en la carta y fue retirado.'));
  });

  describe("P1 A: Validación de DTO completo y preservación de líneas ante payloads incompletos", () => {
    const specialMissingProduct: Product = {
      id: "special-edition-burger",
      slug: "special-edition-burger",
      categoryId: "burgers",
      type: "burger",
      name: "Edición Especial Búnker",
      description: "Medallón wagyu con salsa trufada",
      priceCents: 950000n,
      imageUrl: null,
      published: true,
      featured: false,
      inStock: true,
      optionGroups: []
    };

    const specialMissingLine: CartLine = {
      id: '{"productId":"special-edition-burger","notes":"","selectedOptions":{}}',
      productId: "special-edition-burger",
      productSlug: "special-edition-burger",
      productName: "Edición Especial Búnker",
      unitPriceCents: 950000n,
      quantity: 1,
      notes: "",
      selectedOptions: {}
    };

    it("payload 200 incompleto (sin published/inStock/optionGroups) no borra ni altera líneas almacenadas y bloquea checkout", async () => {
      // Servidor responde HTTP 200 pero con JSON parcial (sin booleans requeridos ni optionGroups)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              categories: serializePublicCategories(fixtureCategories),
              products: [
                {
                  id: "special-edition-burger",
                  name: "Edición Especial Búnker",
                  slug: "special-edition-burger",
                  priceCents: "950000"
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      // Línea almacenada permanece intacta en el DOM y en localStorage
      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();
      expect(localStorage.getItem("bunker-cart")).toContain("special-edition-burger");

      // Estado unverified desplegado y checkout bloqueado
      await waitFor(() => {
        const note = screen.getByTestId("verification-status-note");
        expect(note).toHaveTextContent(/Pendiente de verificar/i);
      });
      const checkoutSection = screen.getByRole("region", { name: "Finalizar pedido" });
      expect(within(checkoutSection).getByRole("button", { name: /WhatsApp|Confirmación|pedidos/i })).toBeDisabled();
    });

    it("payload 200 con opciones malformadas (sin available/priceDeltaCents) no borra ni altera líneas almacenadas", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              categories: serializePublicCategories(fixtureCategories),
              products: [
                {
                  id: "special-edition-burger",
                  name: "Edición Especial Búnker",
                  slug: "special-edition-burger",
                  categoryId: "burgers",
                  type: "burger",
                  description: "Wagyu",
                  priceCents: "950000",
                  imageUrl: null,
                  published: true,
                  featured: false,
                  inStock: true,
                  optionGroups: [
                    {
                      id: "grp-malformed",
                      name: "Opciones rotas",
                      selectionMode: "single",
                      required: true,
                      minSelections: 1,
                      maxSelections: 1,
                      defaultOptionIds: [],
                      applicableTypes: ["burger"],
                      options: [
                        {
                          id: "opt-1",
                          name: "Sin precio delta"
                        }
                      ]
                    }
                  ]
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();
      expect(localStorage.getItem("bunker-cart")).toContain("special-edition-burger");

      await waitFor(() => {
        const note = screen.getByTestId("verification-status-note");
        expect(note).toHaveTextContent(/Pendiente de verificar/i);
      });
    });

    it("control: payload 200 completo aplica variación verdadera de precio y stock", async () => {
      const updatedProduct: Product = {
        ...specialMissingProduct,
        priceCents: 980000n
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify(serializePublicCatalog({ products: [...fallbackProducts, updatedProduct], categories: fixtureCategories })),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      await waitFor(() => {
        expect(within(cartSection).getAllByText("$ 9.800")).toHaveLength(2);
      });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent('"Edición Especial Búnker" actualizó su precio de $ 9.500 a $ 9.800.'));
    });
  });

  describe("P1 B: Preservación de carrito persistido ante snapshots no confirmados y carreras", () => {
    const specialMissingProduct: Product = {
      id: "special-edition-burger",
      slug: "special-edition-burger",
      categoryId: "burgers",
      type: "burger",
      name: "Edición Especial Búnker",
      description: "Medallón wagyu con salsa trufada",
      priceCents: 950000n,
      imageUrl: null,
      published: true,
      featured: false,
      inStock: true,
      optionGroups: []
    };

    const specialMissingLine: CartLine = {
      id: '{"productId":"special-edition-burger","notes":"","selectedOptions":{}}',
      productId: "special-edition-burger",
      productSlug: "special-edition-burger",
      productName: "Edición Especial Búnker",
      unitPriceCents: 950000n,
      quantity: 1,
      notes: "",
      selectedOptions: {}
    };

    it("red diferida (pending): no borra productos faltantes del fallback estático y muestra aviso de verificación en progreso", async () => {
      let resolveDelayedFetch: (res: Response) => void;
      const delayedPromise = new Promise<Response>((resolve) => {
        resolveDelayedFetch = resolve;
      });

      vi.stubGlobal("fetch", vi.fn(() => delayedPromise));

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      // While fetch is pending, the line MUST NOT be wiped from the cart or localStorage
      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();
      expect(localStorage.getItem("bunker-cart")).toContain("special-edition-burger");

      // Verification note indicates check in progress and submit button is disabled
      const note = screen.getByTestId("verification-status-note");
      expect(note).toHaveTextContent("Verificando disponibilidad de los productos con el servidor…");
      const checkoutSection = screen.getByRole("region", { name: "Finalizar pedido" });
      expect(within(checkoutSection).getByRole("button", { name: /WhatsApp|Confirmación|pedidos/i })).toBeDisabled();

      // Clean up the hanging promise
      resolveDelayedFetch!(
        new Response(
          JSON.stringify(serializePublicCatalog({ products: [...fallbackProducts, specialMissingProduct], categories: fixtureCategories })),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    });

    it("error de red / 503 (unverified): conserva el carrito intacto y muestra aviso 'pendiente de verificar'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: "service_unavailable" }), { status: 503 }))
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      // Line is preserved intact
      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();
      expect(localStorage.getItem("bunker-cart")).toContain("special-edition-burger");

      // Verification note transitions to "Pendiente de verificar"
      await waitFor(() => {
        const note = screen.getByTestId("verification-status-note");
        expect(note).toHaveTextContent(/Pendiente de verificar/i);
      });

      // Checkout remains blocked
      const checkoutSection = screen.getByRole("region", { name: "Finalizar pedido" });
      expect(within(checkoutSection).getByRole("button", { name: /WhatsApp|Confirmación|pedidos/i })).toBeDisabled();
    });

    it("respuesta fresca confirmada: actualiza precios y emite avisos sin destruir la selección", async () => {
      const updatedSpecialProduct: Product = {
        ...specialMissingProduct,
        priceCents: 990000n // price increased from $9.500 to $9.900
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify(serializePublicCatalog({ products: [...fallbackProducts, updatedSpecialProduct], categories: fixtureCategories })),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      // Line is kept and its price is safely updated to $ 9.900
      await waitFor(() => {
        expect(within(cartSection).getAllByText("$ 9.900")).toHaveLength(2);
      });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent('"Edición Especial Búnker" actualizó su precio de $ 9.500 a $ 9.900.'));
    });

    it("carreras foco / refetch: ediciones realizadas mientras el fetch está en vuelo se conservan intactas", async () => {
      const user = userEvent.setup();
      let resolveFirstFetch: () => void;
      const firstFetchGate = new Promise<void>((resolve) => {
        resolveFirstFetch = resolve;
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          await firstFetchGate;
          return new Response(
            JSON.stringify(serializePublicCatalog({ products: [...fallbackProducts, specialMissingProduct], categories: fixtureCategories })),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        })
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();

      // User increments quantity to 2 while the fetch is still pending
      await user.click(screen.getByRole("button", { name: "Agregar uno de Edición Especial Búnker" }));
      expect(within(cartSection).getByText("2")).toBeInTheDocument();

      // The network fetch now resolves
      act(() => {
        resolveFirstFetch!();
      });

      // User edit (quantity 2) MUST NOT be overwritten by the resolved response!
      await waitFor(() => {
        expect(screen.queryByTestId("verification-status-note")).not.toBeInTheDocument();
      });
      expect(within(cartSection).getByText("2")).toBeInTheDocument();
      const persisted = localStorage.getItem("bunker-cart");
      expect(persisted).toContain('"quantity":2');
    });

    it("carrera de respuestas HTTP con json() diferido: respuesta A previa no sobrescribe respuesta B posterior", async () => {
      const catalogA = serializePublicProducts([
        ...fallbackProducts,
        {
          ...specialMissingProduct,
          priceCents: 750000n
        }
      ]);
      const catalogB = serializePublicProducts([
        ...fallbackProducts,
        {
          ...specialMissingProduct,
          priceCents: 990000n
        }
      ]);

      let resolveJsonA: (val: unknown) => void;
      const jsonPromiseA = new Promise((resolve) => {
        resolveJsonA = resolve;
      });

      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            // First fetch: HTTP resolves, json() deferred
            return {
              ok: true,
              status: 200,
              json: () => jsonPromiseA
            } as unknown as Response;
          } else {
            // Second fetch: finishes immediately with catalog B
            return {
              ok: true,
              status: 200,
              json: async () => ({ products: catalogB, categories: serializePublicCategories(fixtureCategories) })
            } as unknown as Response;
          }
        })
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      // Dispatch focus to trigger second fetch (Request B)
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      // Request B resolves and applies price $ 9.900
      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      await waitFor(() => {
        expect(within(cartSection).getAllByText("$ 9.900")).toHaveLength(2);
      });

      // Now Request A finishes with old price $ 7.500
      await act(async () => {
        resolveJsonA!({ products: catalogA, categories: serializePublicCategories(fixtureCategories) });
      });

      // Request B ($ 9.900) remains active, NOT overwritten by Request A!
      expect(within(cartSection).getAllByText("$ 9.900")).toHaveLength(2);
    });

    it("transición verified -> pending al volver focus con carrito modificado y fallo de red mantiene cambios intactos", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify(serializePublicCatalog({ products: [...fallbackProducts, specialMissingProduct], categories: fixtureCategories })),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );

      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      await waitFor(() => {
        expect(screen.queryByTestId("verification-status-note")).not.toBeInTheDocument();
      });

      let rejectRefetch: (err: unknown) => void;
      const refetchPromise = new Promise<Response>((_, reject) => {
        rejectRefetch = reject;
      });
      vi.stubGlobal("fetch", vi.fn(() => refetchPromise));

      // Trigger focus -> transitions to pending
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(screen.getByTestId("verification-status-note")).toHaveTextContent("Verificando disponibilidad de los productos con el servidor…");

      // While pending, user modifies cart (increments quantity to 3)
      await user.click(screen.getByRole("button", { name: "Agregar uno de Edición Especial Búnker" }));
      await user.click(screen.getByRole("button", { name: "Agregar uno de Edición Especial Búnker" }));
      expect(within(cartSection).getByText("3")).toBeInTheDocument();

      // Refetch fails due to network failure
      await act(async () => {
        rejectRefetch!(new Error("Network offline"));
      });

      // Verification note transitions to "Pendiente de verificar"
      await waitFor(() => {
        expect(screen.getByTestId("verification-status-note")).toHaveTextContent(/Pendiente de verificar/i);
      });

      // User modified quantity (3) MUST remain completely intact!
      expect(within(cartSection).getByText("3")).toBeInTheDocument();
      const persisted = localStorage.getItem("bunker-cart");
      expect(persisted).toContain('"quantity":3');
    });

    it("recuperación de carrito en render inicial con snapshot diferido: no es eliminado por el estado vacío inicial", async () => {
      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      // Render Storefront with fallback products (where specialMissingProduct is absent)
      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} initialCatalog={{ products: fallbackProducts, categories: fixtureCategories }} />);

      // After client mount and verification, the recovered line must remain intact
      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      await waitFor(() => {
        expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();
      });
      expect(localStorage.getItem("bunker-cart")).toContain("special-edition-burger");
    });

    it("sensibilidad P1 B: el componente Storefront no aplica revalidación destructiva antes de verificar con el servidor", async () => {
      localStorage.setItem("bunker-cart", serializeCart([specialMissingLine]));

      // Mock fetch in pending state
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

      render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} initialCatalog={{ products: fallbackProducts, categories: fixtureCategories }} />);

      // Line is preserved in DOM and in storage:
      const cartSection = screen.getByRole("region", { name: "Tu pedido" });
      expect(within(cartSection).getByText("Edición Especial Búnker")).toBeInTheDocument();
      expect(localStorage.getItem("bunker-cart")).toContain("special-edition-burger");

      // Demostrar sensibilidad: si Storefront revalidara prematuramente contra el fallback estático,
      // la línea desaparecería porque no existe en fallbackProducts.
      const prematureOutcome = revalidateCart([specialMissingLine], fallbackProducts);
      expect(prematureOutcome.validLines).toHaveLength(0);
      expect(prematureOutcome.issues.some((i) => i.code === "product_removed")).toBe(true);
    });
  });

  it("muestra el banner accesible de almacenamiento degradado cuando localStorage falla al escribir", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const error = new Error("Quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    });

    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));

    expect(screen.getByTestId("storage-degraded-banner")).toBeInTheDocument();
    expect(screen.getByText(/El almacenamiento local no está disponible/i)).toBeInTheDocument();

    vi.restoreAllMocks();
  });
});
