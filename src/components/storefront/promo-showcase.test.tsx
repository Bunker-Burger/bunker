import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PromotionRule } from "@/domain/types";
import { PromoShowcase, showcasePromotions } from "./promo-showcase";

const NOW = new Date("2026-10-13T23:00:00Z");
const TZ = "America/Argentina/Tucuman";

const promotion = (overrides: Partial<PromotionRule>): PromotionRule => ({
  id: "p1",
  slug: "p1",
  name: "2x1 Burger Night",
  description: "",
  badgeText: "2x1",
  imageUrl: "https://cdn.test/catalog/s1/promotions/p1.webp",
  priority: 1,
  active: true,
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-12-01T00:00:00Z"),
  mechanic: { type: "percent_off", percentOff: 50 },
  channels: ["delivery", "pickup"],
  items: [],
  schedule: [],
  ...overrides
});

describe("promotions at the top of the menu (issue #54)", () => {
  it("shows the promotions in effect now, with or without a photo", () => {
    const rules = [
      promotion({ id: "shown" }),
      promotion({ id: "no-photo", imageUrl: null }),
      promotion({ id: "paused", active: false }),
      promotion({ id: "ended", endsAt: new Date("2026-10-10T00:00:00Z") }),
      promotion({ id: "other-day", schedule: [{ dayOfWeek: 1, startsAt: "10:00:00", endsAt: "11:00:00" }] })
    ];
    expect(showcasePromotions(rules, NOW, TZ).map((rule) => rule.id)).toEqual(["shown", "no-photo"]);
    expect(showcasePromotions(rules, null, TZ)).toEqual([]);
  });

  it("renders the banner with photo, badge, name and what the promotion does", () => {
    render(<PromoShowcase layout="banner" promotions={[promotion({})]} />);
    const banner = screen.getByRole("region", { name: "Promociones" });
    expect(within(banner).getByRole("heading", { name: "2x1 Burger Night" })).toBeInTheDocument();
    expect(within(banner).getByText("2x1")).toBeInTheDocument();
    expect(within(banner).getByText(/50%/)).toBeInTheDocument();
    expect(banner.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/catalog/s1/promotions/p1.webp");
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("shows a promotion without a photo with the tile and its icon, in the banner and the section", () => {
    render(<PromoShowcase layout="both" promotions={[promotion({ imageUrl: null })]} />);
    for (const region of [screen.getByRole("region", { name: "Promociones destacadas" }), screen.getByRole("region", { name: "Promociones" })]) {
      expect(region.querySelector("img")).toBeNull();
      expect(region.querySelector(".promo-tile svg")).not.toBeNull();
    }
  });

  it("renders a Promociones section with the menu's cards", () => {
    render(<PromoShowcase layout="section" promotions={[promotion({})]} />);
    const section = screen.getByRole("region", { name: "Promociones" });
    expect(within(section).getByRole("heading", { level: 2, name: "Promociones" })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 3, name: "2x1 Burger Night" })).toBeInTheDocument();
    expect(within(section).getByText("Se aplica sola al pedido")).toBeInTheDocument();
  });

  it("shows the banner and the section together with ?promos=ambas, to compare", () => {
    render(<PromoShowcase layout="both" promotions={[promotion({})]} />);
    expect(screen.getByRole("region", { name: "Promociones destacadas" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Promociones" })).toBeInTheDocument();
    expect(screen.getAllByText("2x1 Burger Night")).toHaveLength(2);
  });

  it("renders nothing without promotions", () => {
    const { container } = render(<PromoShowcase layout="banner" promotions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
