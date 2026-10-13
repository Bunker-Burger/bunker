import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicPromotion } from "@/domain/public-promotions";
import { Storefront } from "./storefront";

const promotion: PublicPromotion = {
  id: "0199b2c8-40b0-7000-8000-000000000501",
  slug: "martes-de-smash",
  name: "Martes de Smash",
  priority: 10,
  startsAt: "2026-10-01T03:00:00.000Z",
  endsAt: "2027-04-01T02:59:00.000Z",
  mechanic: { type: "percent_off", percentOff: 15 },
  channels: ["delivery", "pickup"],
  items: [],
  schedule: [],
  imageUrl: "https://cdn.test/catalog/s1/promotions/martes.jpg",
  badgeText: "15% OFF"
};

const page = (props: { initialPromotions?: PublicPromotion[]; renderedAt?: number }) =>
  renderToString(
    <Storefront
      catalogFallback="empty"
      initialCatalog={{ products: [], categories: [] }}
      initialProductSlug={null}
      mercadoPagoEnabled={false}
      {...props}
    />
  );

describe("promotions arrive with the page", () => {
  it("renders the banner on the server when the page carries the promotions and the time", () => {
    const html = page({ initialPromotions: [promotion], renderedAt: Date.parse("2026-10-13T23:00:00Z") });
    expect(html).toContain("promo-banner");
    expect(html).toContain("Martes de Smash");
  });

  it("renders no banner without them, until the client reads them", () => {
    expect(page({ initialPromotions: [promotion] })).not.toContain("promo-banner");
    expect(page({ renderedAt: Date.parse("2026-10-13T23:00:00Z") })).not.toContain("promo-banner");
  });
});
