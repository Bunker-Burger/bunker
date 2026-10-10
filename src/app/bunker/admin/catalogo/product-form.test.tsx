import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdminFormState } from "./form-state";
import { ProductForm, type ProductFormCategory, type ProductFormOptionGroup } from "./product-form";

vi.mock("./actions", () => ({ saveProductAction: vi.fn() }));

const categories: ProductFormCategory[] = [
  { id: "c-burgers", name: "Hamburguesas", type: "burger", tabLabel: "Hamburguesas" },
  { id: "c-drinks", name: "Bebidas", type: "beverage", tabLabel: "Bebidas" }
];

const groups: ProductFormOptionGroup[] = [
  {
    id: "g-size", name: "Tamaño", selectionMode: "single", required: true, minSelections: 1, maxSelections: 1, applicableTypes: ["burger"],
    options: [{ id: "o-double", name: "Doble", priceDelta: null, available: true }, { id: "o-triple", name: "Triple", priceDelta: "$ 1.600", available: true }]
  },
  {
    id: "g-extras", name: "Extras", selectionMode: "multiple", required: false, minSelections: 0, maxSelections: 3, applicableTypes: ["burger"],
    options: [{ id: "o-bacon", name: "Bacon", priceDelta: "$ 900", available: true }, { id: "o-pickles", name: "Pepinillos", priceDelta: "$ 300", available: false }]
  }
];

describe("ProductForm", () => {
  it("lists only the option groups of the chosen category's type", async () => {
    render(<ProductForm categories={categories} defaultCategoryId="c-burgers" optionGroups={groups} />);
    expect(screen.getByRole("checkbox", { name: /Ofrecer Tamaño/ })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Categoría" }), "c-drinks");
    expect(screen.queryByRole("checkbox", { name: /Ofrecer Tamaño/ })).not.toBeInTheDocument();
    expect(screen.getByText("No hay grupos de opciones para este tipo de producto.")).toBeInTheDocument();
    expect(screen.getByText("Las bebidas se guardan siempre sin alcohol.")).toBeInTheDocument();
  });

  it("asks for defaults once a group is offered: one choice for single groups, several for multiple", async () => {
    render(<ProductForm categories={categories} optionGroups={groups} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Tamaño/ }));
    const size = screen.getByRole("group", { name: "Por defecto en Tamaño" });
    expect(within(size).getAllByRole("radio")).toHaveLength(2);
    expect(within(size).getByRole("radio", { name: "Triple (+$ 1.600)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Extras/ }));
    const extras = screen.getByRole("group", { name: "Por defecto en Extras" });
    expect(within(extras).getByRole("checkbox", { name: /Bacon/ })).toBeEnabled();
    expect(within(extras).getByRole("checkbox", { name: /Pepinillos.*sin stock/ })).toBeDisabled();
  });

  it("starts from the product's values and saved defaults", () => {
    render(
      <ProductForm
        categories={categories}
        optionGroups={groups}
        product={{
          id: "p1", categoryId: "c-burgers", name: "Smash", slug: "smash", description: "Doble.", price: "7800",
          inStock: false, featured: true, published: true, optionGroups: [{ groupId: "g-size", defaultOptionIds: ["o-triple"] }]
        }}
      />
    );
    expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("Smash");
    expect(screen.getByRole("spinbutton", { name: "Precio" })).toHaveValue(7800);
    expect(screen.getByRole("checkbox", { name: /Con stock/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Publicado/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Triple (+$ 1.600)" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar producto" })).toBeInTheDocument();
  });

  it("shows the server's publication problems and field errors", async () => {
    const action = vi.fn(async (): Promise<AdminFormState> => ({
      status: "error",
      message: "No se puede publicar: corregí la configuración.",
      issues: ["El producto debe tener una descripción."],
      fieldErrors: { name: "Ingresá un nombre." }
    }));
    render(<ProductForm action={action} categories={categories} optionGroups={groups} />);
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se puede publicar"));
    expect(screen.getByRole("alert")).toHaveTextContent("El producto debe tener una descripción.");
    const name = screen.getByRole("textbox", { name: "Nombre" });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Ingresá un nombre.");
  });
});
