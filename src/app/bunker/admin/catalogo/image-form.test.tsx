import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageForm } from "./image-form";

vi.mock("./actions", () => ({ saveProductImageAction: vi.fn(), deleteProductImageAction: vi.fn() }));

const limits = { maxBytes: 5 * 1024 * 1024, minSide: 320, maxSide: 4096 };

describe("ImageForm", () => {
  it("accepts only raster formats and states the limits", () => {
    render(<ImageForm image={null} productId="p1" productName="Smash" {...limits} />);
    const input = screen.getByLabelText("Foto");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/avif");
    expect(input).toHaveAccessibleDescription(/JPEG, PNG, WebP o AVIF; hasta 5 MB y entre 320 y 4096 px por lado\. SVG no\./);
    expect(screen.getByRole("button", { name: "Subir foto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar foto" })).not.toBeInTheDocument();
  });

  it("previews the crop at the chosen focal point", () => {
    render(<ImageForm image={{ url: "https://x.supabase.co/a.webp", alt: "Smash", focalX: 20, focalY: 80 }} productId="p1" productName="Smash" {...limits} />);
    const preview = screen.getByRole("group", { name: /Punto focal/ }).querySelector("img");
    expect(preview).toHaveStyle({ objectPosition: "20% 80%" });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Punto focal horizontal (%)" }), { target: { value: "150" } });
    expect(preview).toHaveStyle({ objectPosition: "100% 80%" });

    fireEvent.keyDown(screen.getByRole("group", { name: /Punto focal/ }), { key: "ArrowUp", shiftKey: true });
    expect(preview).toHaveStyle({ objectPosition: "100% 70%" });
    expect(screen.getByRole("button", { name: "Guardar foto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar foto" })).toBeInTheDocument();
  });

  it("warns before sending a file over 5 MB", () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    render(<ImageForm image={null} productId="p1" productName="Smash" {...limits} />);
    const big = new File([new Uint8Array(limits.maxBytes + 1)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Foto"), { target: { files: [big] } });
    expect(screen.getByText("La imagen supera los 5 MB; el servidor la va a rechazar.")).toBeInTheDocument();
  });
});
