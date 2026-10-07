import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "./badge";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "./drawer";
import { Input } from "./input";
import { EmptyState, ErrorState } from "./state-message";
import { Switch } from "./switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("Button", () => {
  it("keeps dark text on the amber fill", () => {
    render(<Button>Agregar</Button>);
    const button = screen.getByRole("button", { name: "Agregar" });
    expect(button.className).toContain("text-on-primary");
    expect(button.className).toContain("min-h-12");
  });

  it("blocks clicks and announces progress while loading", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Enviar</Button>);
    const button = screen.getByRole("button", { name: "Enviar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Badge", () => {
  it("renders the sold-out state with the red token", () => {
    render(<Badge variant="soldOut">Agotado</Badge>);
    expect(screen.getByText("Agotado").className).toContain("text-danger-text");
  });
});

describe("Input", () => {
  it("exposes the invalid state to assistive tech", () => {
    render(<Input aria-label="Dirección" aria-invalid="true" />);
    expect(screen.getByRole("textbox", { name: "Dirección" })).toBeInvalid();
  });
});

describe("Switch", () => {
  it("toggles with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Retiro en el local" />);
    const toggle = screen.getByRole("switch", { name: "Retiro en el local" });
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toBeChecked();
  });
});

describe("Tabs", () => {
  it("moves between tabs with arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Categorías">
          <TabsTrigger value="a">Hamburguesas</TabsTrigger>
          <TabsTrigger value="b">Papas</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Smash</TabsContent>
        <TabsContent value="b">Rústicas</TabsContent>
      </Tabs>
    );
    await user.click(screen.getByRole("tab", { name: "Hamburguesas" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Papas" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Rústicas");
  });
});

describe("Dialog and Drawer", () => {
  it("opens a dialog, traps focus on the close button and closes with Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>¿Vaciar el carrito?</DialogTitle>
          <DialogDescription>No se puede deshacer.</DialogDescription>
        </DialogContent>
      </Dialog>
    );
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("dialog", { name: "¿Vaciar el carrito?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus();
  });

  it("renders the drawer as an accessible dialog", async () => {
    const user = userEvent.setup();
    render(
      <Drawer>
        <DrawerTrigger>Personalizar</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Smash Búnker Doble</DrawerTitle>
          <DrawerDescription>Elegí tus extras.</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );
    await user.click(screen.getByRole("button", { name: "Personalizar" }));
    expect(screen.getByRole("dialog", { name: "Smash Búnker Doble" })).toHaveAccessibleDescription("Elegí tus extras.");
  });
});

describe("State messages", () => {
  it("renders empty and error states, the error as an alert", () => {
    render(
      <>
        <EmptyState title="Tu carrito está vacío" description="Elegí algo de la carta." />
        <ErrorState title="No pudimos cargar la carta" />
      </>
    );
    expect(screen.getByRole("heading", { name: "Tu carrito está vacío" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar la carta");
  });
});
