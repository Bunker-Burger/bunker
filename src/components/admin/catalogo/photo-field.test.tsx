import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhotoField } from "./photo-field";

const labels = { hint: "Se ve en la carta.", legend: "Foto del producto", replaceLabel: "Reemplazar foto", uploadLabel: "Subir foto del producto" };
const limits = { maxBytes: 5 * 1024 * 1024, minSide: 320, maxSide: 4096 };

function renderField(photo: Parameters<typeof PhotoField>[0]["photo"]) {
  const { container } = render(
    <form>
      <PhotoField {...labels} photo={photo} />
    </form>
  );
  const hidden = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  return { hidden };
}

describe("PhotoField (issue #54)", () => {
  it("accepts only raster formats and states the limits", () => {
    renderField({ url: null, ...limits, focal: { x: 50, y: 50 } });
    const input = screen.getByLabelText("Subir foto del producto");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/avif");
    expect(input).toHaveAttribute("name", "image");
    expect(input).toHaveAccessibleDescription(/hasta 5 MB y entre 320 y 4096 px por lado/);
    expect(screen.queryByLabelText("Quitar la foto al guardar")).not.toBeInTheDocument();
  });

  it("has no numbers to type: the photo is recentred by dragging it", () => {
    const { hidden } = renderField({ url: "https://x.supabase.co/a.webp", ...limits, focal: { x: 50, y: 50 } });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const frame = screen.getByRole("group", { name: /Acomodar la foto/ });
    frame.setPointerCapture = vi.fn();
    frame.getBoundingClientRect = () => ({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    expect(hidden("photoMoved")).toBeNull();

    fireEvent.pointerDown(frame, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 140, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(frame, { pointerId: 1 });

    expect(frame.querySelector("img")).toHaveStyle({ objectPosition: "30% 70%" });
    expect([hidden("focalX")?.value, hidden("focalY")?.value, hidden("photoMoved")?.value]).toEqual(["30", "70", "true"]);
  });

  it("moves with the arrow keys too, within the photo", () => {
    const { hidden } = renderField({ url: "https://x.supabase.co/a.webp", ...limits, focal: { x: 5, y: 50 } });
    const frame = screen.getByRole("group", { name: /Acomodar la foto/ });
    fireEvent.keyDown(frame, { key: "ArrowRight", shiftKey: true });
    expect(hidden("focalX")?.value).toBe("0");
  });

  it("offers removing a stored photo", () => {
    renderField({ url: "https://x.supabase.co/a.webp", ...limits, focal: { x: 50, y: 50 } });
    fireEvent.click(screen.getByLabelText("Quitar la foto al guardar"));
    expect(screen.queryByRole("group", { name: /Acomodar la foto/ })).not.toBeInTheDocument();
  });

  it("is a plain preview without framing when the photo has no focal point (promotions)", () => {
    const { hidden } = renderField({ url: "https://x.supabase.co/a.webp", ...limits });
    expect(screen.queryByRole("group", { name: /Acomodar la foto/ })).not.toBeInTheDocument();
    expect(hidden("focalX")).toBeNull();
  });
});
