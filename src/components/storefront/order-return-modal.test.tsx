import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderReturnModal } from "./order-return-modal";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OrderReturnModal (BB-14)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("polls status endpoint and displays approved state with WhatsApp CTA", async () => {
    const onApproved = vi.fn();
    const onClose = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/checkout/mercado-pago/status")) {
          return json({
            status: "approved",
            externalReference: "ext_ref_123",
            paymentReference: "pay_98765432",
            totalCents: "950000",
            whatsappUrl: "https://wa.me/5493865207458?text=Aprobado"
          });
        }
        return json({ error: "not_found" }, 404);
      })
    );

    render(
      <OrderReturnModal
        externalReference="ext_ref_123"
        paymentId="pay_98765432"
        onApproved={onApproved}
        onClose={onClose}
      />
    );

    // Initial state is checking
    expect(screen.getByTestId("order-return-modal")).toBeInTheDocument();
    expect(screen.getByText("Verificando tu pago")).toBeInTheDocument();

    // Transition to approved
    await waitFor(() => {
      expect(screen.getByText("¡Pago acreditado con éxito!")).toBeInTheDocument();
      expect(screen.getByText(/Abrir WhatsApp y coordinar entrega/i)).toBeInTheDocument();
      expect(screen.getByText("$ 9.500")).toBeInTheDocument();
    });

    expect(onApproved).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByRole("button", { name: "Cerrar ventana de estado" });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles rejected status gracefully", async () => {
    const onClose = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/checkout/mercado-pago/status")) {
          return json({
            status: "rejected",
            externalReference: "ext_ref_123",
            message: "Fondos insuficientes en la tarjeta seleccionada."
          });
        }
        return json({ error: "not_found" }, 404);
      })
    );

    render(
      <OrderReturnModal
        externalReference="ext_ref_123"
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No pudimos procesar el pago")).toBeInTheDocument();
      expect(
        screen.getByText("Fondos insuficientes en la tarjeta seleccionada.")
      ).toBeInTheDocument();
      expect(screen.getByText(/Tu carrito está intacto/i)).toBeInTheDocument();
    });

    const backBtn = screen.getByRole("button", { name: "Volver al carrito" });
    await userEvent.click(backBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles expired status gracefully", async () => {
    const onClose = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/checkout/mercado-pago/status")) {
          return json({
            status: "expired",
            externalReference: "ext_ref_123"
          });
        }
        return json({ error: "not_found" }, 404);
      })
    );

    render(
      <OrderReturnModal
        externalReference="ext_ref_123"
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Pago expirado")).toBeInTheDocument();
      expect(
        screen.getByText(/El tiempo para completar este pago ha vencido/i)
      ).toBeInTheDocument();
    });
  });

  it("closes modal on Escape key press", async () => {
    const onClose = vi.fn();
    render(<OrderReturnModal externalReference="ext_ref_123" onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
