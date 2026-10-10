import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  it("submits accessible email and password fields and renders the action error", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({ message: "Email o contraseña incorrectos" }));
    render(<LoginForm action={action} />);

    await user.type(screen.getByRole("textbox", { name: "Email" }), "owner@example.com");
    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveAttribute("type", "password");
    await user.type(password, "wrong");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email o contraseña incorrectos");
  });

  it("disables the submit button while login is pending", async () => {
    const user = userEvent.setup();
    let finish!: (value: { message: string | null }) => void;
    const action = () => new Promise<{ message: string | null }>((resolve) => (finish = resolve));
    render(<LoginForm action={action} />);

    await user.type(screen.getByRole("textbox", { name: "Email" }), "owner@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "secret");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(screen.getByRole("button", { name: "Ingresando…" })).toBeDisabled();
    finish({ message: null });
  });

  it("offers no signup or password-recovery path", () => {
    render(<LoginForm action={async () => ({ message: null })} />);

    expect(screen.queryByRole("link", { name: /registr/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /recuper/i })).not.toBeInTheDocument();
  });
});
