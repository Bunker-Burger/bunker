import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreToast, TOAST_DURATION_MS, type ToastMessage } from "./store-toast";

/** The storefront's usage: every new message gets a new key; dismissing clears it. */
function Harness({ initial = null }: { initial?: ToastMessage | null }) {
  const [message, setMessage] = useState<ToastMessage | null>(initial);
  return (
    <>
      <button onClick={() => setMessage((previous) => ({ text: "Smash se agregó al carrito.", key: (previous?.key ?? 0) + 1, durationMs: TOAST_DURATION_MS }))} type="button">
        add
      </button>
      <StoreToast message={message} onDismiss={() => setMessage(null)} />
    </>
  );
}

const card = () => document.querySelector(".store-toast");

describe("StoreToast (issue #54)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces in a live region that is always in the page and dismisses itself after the duration", () => {
    render(<Harness />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "add" }));
    expect(region).toHaveTextContent("Smash se agregó al carrito.");

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
    // The region stays for the next message.
    expect(screen.getByRole("status")).toBe(region);
  });

  it("keeps the duration between 3 and 5 seconds", () => {
    expect(TOAST_DURATION_MS).toBeGreaterThanOrEqual(3000);
    expect(TOAST_DURATION_MS).toBeLessThanOrEqual(5000);
  });

  it("can be closed by hand", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(card()).toBeNull();
  });

  it("repeated adds leave a single toast and restart its time, never a queue", () => {
    render(<Harness />);
    const add = screen.getByRole("button", { name: "add" });
    fireEvent.click(add);
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(add);
    fireEvent.click(add);
    expect(document.querySelectorAll(".store-toast")).toHaveLength(1);

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
    // No orphan timer dismisses a later message early.
    fireEvent.click(add);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(card()).not.toBeNull();
  });

  it("pauses while hovered or focused and resumes with the time left", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    act(() => vi.advanceTimersByTime(1000));

    fireEvent.mouseEnter(card()!);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 3));
    expect(card()).not.toBeNull();
    fireEvent.mouseLeave(card()!);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1000 - 1));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "add" }));
    fireEvent.focus(screen.getByRole("button", { name: "Cerrar aviso" }));
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 3));
    expect(card()).not.toBeNull();
    fireEvent.blur(screen.getByRole("button", { name: "Cerrar aviso" }));
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(card()).toBeNull();
  });

  it("a state message (no duration) stays without a close button until it stops being true", () => {
    render(<StoreToast message={{ text: "Buscando el producto en la carta…", key: -1, durationMs: null }} onDismiss={() => {}} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("status")).toHaveTextContent("Buscando el producto en la carta…");
    expect(screen.queryByRole("button", { name: "Cerrar aviso" })).toBeNull();
  });
});
