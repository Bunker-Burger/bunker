import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reorderOptionsAction, saveOptionAction, saveProductAction } from "./actions";
import type { AdminFormState } from "./form-state";
import { ProductForm, type ProductFormCategory, type ProductFormOptionGroup } from "./product-form";

vi.mock("./actions", () => ({ saveProductAction: vi.fn(), saveOptionAction: vi.fn(), reorderOptionsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const categories: ProductFormCategory[] = [
  { id: "c-burgers", name: "Hamburguesas", type: "burger", tabLabel: "Hamburguesas" },
  { id: "c-drinks", name: "Bebidas", type: "beverage", tabLabel: "Bebidas" }
];

const groups: ProductFormOptionGroup[] = [
  {
    id: "g-size", name: "Tamaño", selectionMode: "single", required: true, minSelections: 1, maxSelections: 1, applicableTypes: ["burger"],
    options: [{ id: "o-double", name: "Doble", priceDelta: null, price: "0", available: true }, { id: "o-triple", name: "Triple", priceDelta: "$ 1.600", price: "1600", available: true }]
  },
  {
    id: "g-extras", name: "Extras", selectionMode: "multiple", required: false, minSelections: 0, maxSelections: 3, applicableTypes: ["burger"],
    options: [{ id: "o-bacon", name: "Bacon", priceDelta: "$ 900", price: "900", available: true }, { id: "o-pickles", name: "Pepinillos", priceDelta: "$ 300", price: "300", available: false }]
  }
];

describe("ProductForm", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not repeat the type when the category has the same name in other letters (PAPAS, not Papas · PAPAS)", () => {
    render(<ProductForm categories={[{ id: "c-fries", name: "PAPAS", type: "fries", tabLabel: "Papas" }, ...categories]} optionGroups={groups} />);
    expect(screen.getByRole("radio", { name: "PAPAS" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /·/ })).not.toBeInTheDocument();
  });

  it("lists only the option groups of the chosen category's type", async () => {
    render(<ProductForm categories={categories} defaultCategoryId="c-burgers" optionGroups={groups} />);
    expect(screen.getByRole("checkbox", { name: /Ofrecer Tamaño/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /Bebidas/ }));
    expect(screen.queryByRole("checkbox", { name: /Ofrecer Tamaño/ })).not.toBeInTheDocument();
    expect(screen.getByText("No hay grupos de opciones para este tipo de producto.")).toBeInTheDocument();
    expect(screen.getByText("Las bebidas se guardan siempre sin alcohol.")).toBeInTheDocument();
  });

  it("asks for defaults once a group is offered: one choice for single groups, several for multiple", async () => {
    render(<ProductForm categories={categories} optionGroups={groups} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Tamaño/ }));
    const size = screen.getByRole("group", { name: "Opciones de Tamaño" });
    expect(within(size).getAllByRole("radio")).toHaveLength(2);
    expect(within(size).getByRole("radio", { name: "Triple por defecto" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Extras/ }));
    const extras = screen.getByRole("group", { name: "Opciones de Extras" });
    expect(within(extras).getByRole("checkbox", { name: "Bacon por defecto" })).toBeEnabled();
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
    expect(screen.getByRole("spinbutton", { name: "Precio base" })).toHaveValue(7800);
    expect(screen.getByRole("checkbox", { name: /Con stock/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Publicado/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Triple por defecto" })).toBeChecked();
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

  it("sends the edited extras with the product, so one button saves everything (issue #54)", async () => {
    vi.mocked(saveProductAction).mockResolvedValue({ status: "success", message: "ok" });
    render(<ProductForm categories={categories} defaultCategoryId="c-burgers" optionGroups={groups} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Tamaño/ }));
    expect(screen.queryByRole("button", { name: /^Guardar (Doble|Triple)/ })).not.toBeInTheDocument();

    const name = screen.getByRole("textbox", { name: "Nombre de Doble" });
    await userEvent.clear(name);
    await userEvent.type(name, "Simple");
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(saveProductAction).toHaveBeenCalled());
    const sent = vi.mocked(saveProductAction).mock.calls.at(-1)![1];
    expect(sent.getAll("touchedOption")).toEqual(["g-size|o-double"]);
    expect(sent.get("optionName:o-double")).toBe("Simple");
    expect(sent.get("optionPrice:o-double")).toBe("0");
    expect(sent.get("optionAvailable:o-double")).toBe("true");
    expect(saveOptionAction).not.toHaveBeenCalled();
  });

  it("sends a new option typed under a group with the product, e.g. one more medallion", async () => {
    vi.mocked(saveProductAction).mockResolvedValue({ status: "success", message: "ok" });
    render(<ProductForm categories={categories} defaultCategoryId="c-burgers" optionGroups={groups} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Extras/ }));
    expect(screen.queryByRole("button", { name: "Añadir" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Nombre de la nueva opción de Extras" }), "Medallón de carne");
    await userEvent.type(screen.getByRole("textbox", { name: "Precio extra de la nueva opción de Extras" }), "1400");
    await userEvent.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(saveProductAction).toHaveBeenCalled());
    const sent = vi.mocked(saveProductAction).mock.calls.at(-1)![1];
    expect(sent.getAll("newOptionGroup")).toEqual(["g-extras"]);
    expect(sent.get("newOptionName:g-extras")).toBe("Medallón de carne");
    expect(sent.get("newOptionPrice:g-extras")).toBe("1400");
    expect(sent.getAll("touchedOption")).toEqual([]);
  });

  it("moves an option with the arrow keys on its handle and saves the group's new order", async () => {
    vi.mocked(reorderOptionsAction).mockResolvedValue({ status: "success", message: "ok" });
    render(<ProductForm categories={categories} defaultCategoryId="c-burgers" optionGroups={groups} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Ofrecer Tamaño/ }));

    screen.getByRole("button", { name: /Mover Triple/ }).focus();
    await userEvent.keyboard("{ArrowUp}");

    const size = screen.getByRole("group", { name: "Opciones de Tamaño" });
    expect(within(size).getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["o-triple", "o-double"]);
    await waitFor(() => expect(reorderOptionsAction).toHaveBeenCalled());
    const sent = vi.mocked(reorderOptionsAction).mock.calls.at(-1)![1];
    expect(sent.get("groupId")).toBe("g-size");
    expect(sent.getAll("optionId")).toEqual(["o-triple", "o-double"]);
    expect(screen.getByRole("button", { name: /Mover Triple/ })).toHaveFocus();
  });

  it("previews the product as the menu will show it while the form is filled (issue #54)", async () => {
    render(<ProductForm categories={categories} defaultCategoryId="c-burgers" optionGroups={groups} />);
    const preview = screen.getByRole("region", { name: "Así se verá en la carta" });
    await waitFor(() => expect(within(preview).getByRole("heading", { name: "Nombre del producto" })).toBeInTheDocument());

    await userEvent.type(screen.getByRole("textbox", { name: "Nombre" }), "Doble Bacon");
    await userEvent.type(screen.getByRole("spinbutton", { name: /Precio base/ }), "8900");
    await waitFor(() => expect(within(preview).getByRole("heading", { name: "Doble Bacon" })).toBeInTheDocument());
    await waitFor(() => expect(within(preview).getByText(/8\.900/)).toBeInTheDocument());
    expect(within(preview).getByText(/8.900/)).toBeInTheDocument();
    expect(within(preview).getAllByRole("heading", { name: "Doble Bacon" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("checkbox", { name: "Destacado" }));
    await waitFor(() => expect(within(preview).getAllByRole("heading", { name: "Doble Bacon" })).toHaveLength(2));
    expect(within(preview).getByText("En “Las más pedidas”")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Con stock/ }));
    await waitFor(() => expect(within(preview).getAllByText("Agotado")).toHaveLength(2));
  });
});
