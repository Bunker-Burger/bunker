import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promotions as catalogPromotions } from "@/data/catalog";
import type { PromotionRule } from "@/domain/types";
import { Storefront } from "./storefront";

/*
 * BB-09 in the menu: a struck-through price derived from the real price, and an explanation of
 * the single applied promotion generated from its mechanic (never admin free text).
 */

// Tuesday 2026-10-13 21:00 and Wednesday 2026-10-14 21:00 in Tucumán (UTC-3).
const TUESDAY_NIGHT = new Date("2026-10-14T00:00:00Z");
const WEDNESDAY_NIGHT = new Date("2026-10-15T00:00:00Z");

const [martes] = catalogPromotions as [PromotionRule];

function at(instant: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
}

beforeEach(() => {
  localStorage.clear();
  // The store status endpoint is irrelevant here; leave it pending.
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const smashCard = () => screen.getByRole("heading", { name: "Smash Búnker Doble" }).closest("article") as HTMLElement;

describe("promotions in the storefront", () => {
  it("strikes the real price and shows the promotional one while the promotion is in effect", () => {
    at(TUESDAY_NIGHT);
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    const card = within(smashCard());
    expect(card.getByText("$ 7.800", { selector: "s" })).toBeInTheDocument();
    expect(card.getByText("$ 6.630")).toBeInTheDocument();
    expect(card.getByText("Martes de Smash: 15% de descuento en productos seleccionados")).toBeInTheDocument();
    // Other products keep their price untouched.
    const oklahoma = within(screen.getByRole("heading", { name: "Oklahoma Onion" }).closest("article") as HTMLElement);
    expect(oklahoma.queryByText(/de descuento/)).not.toBeInTheDocument();
  });

  it("explains the single applied promotion in the checkout and estimates the total with it", async () => {
    at(TUESDAY_NIGHT);
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const tenPercent: PromotionRule = { ...martes, id: "diez", slug: "diez", name: "Diez por ciento", priority: 5, items: [], schedule: [], mechanic: { type: "percent_off", percentOff: 10 } };
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} promotions={[tenPercent, martes]} />);

    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));

    const applied = within(screen.getByTestId("applied-promotion"));
    expect(applied.getByText("Promoción: Martes de Smash")).toBeInTheDocument();
    expect(applied.getByText("-$ 1.170")).toBeInTheDocument();
    expect(applied.getByText("15% de descuento en productos seleccionados. No se acumula con otras promociones.")).toBeInTheDocument();
    expect(screen.getAllByTestId("applied-promotion")).toHaveLength(1);
    // The order-wide 10% (lower priority) is announced on other cards, but never stacks here.
    const summary = screen.getByRole("heading", { name: "Resumen de la orden" }).parentElement as HTMLElement;
    expect(within(summary).queryByText(/Diez por ciento|10%/)).not.toBeInTheDocument();
    expect(within(summary).getByText("Total estimado").nextElementSibling).toHaveTextContent("$ 6.630");
  });

  it("shows no promotion outside its weekly window", async () => {
    at(WEDNESDAY_NIGHT);
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} />);

    expect(within(smashCard()).queryByText("$ 7.800", { selector: "s" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar Smash Búnker Doble" }));
    expect(screen.queryByTestId("applied-promotion")).not.toBeInTheDocument();
  });

  it("shows nothing for a paused promotion", () => {
    at(TUESDAY_NIGHT);
    render(<Storefront initialProductSlug={null} mercadoPagoEnabled={false} promotions={[{ ...martes, active: false }]} />);
    expect(within(smashCard()).queryByText(/de descuento/)).not.toBeInTheDocument();
  });

  it("never displays admin free text as the promotion's price or explanation", () => {
    at(TUESDAY_NIGHT);
    render(
      <Storefront
        initialProductSlug={null}
        mercadoPagoEnabled={false}
        promotions={[{ ...martes, description: "¡Todo a $1!", badgeText: "$1" }]}
      />
    );
    expect(screen.queryByText(/\$1\b|Todo a/)).not.toBeInTheDocument();
    expect(within(smashCard()).getByText("$ 6.630")).toBeInTheDocument();
  });
});
