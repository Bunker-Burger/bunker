import { PAYMENT_METHOD_NAME, PUBLIC_PAYMENT_NOTE } from "@/domain/public-payment-options";
import { focalStyle } from "@/components/storefront/focal-style";
import { explainPromotion, isPromotionInEffect } from "@/domain/promotions";
import type { PromotionMechanic } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { getCatalogAdminView } from "@/server/catalog-admin";
import { getStoreAdminView, PAYMENT_METHODS } from "@/server/store-admin";
import styles from "../admin.module.css";
import { formValues, pesos } from "./catalogo/product-props";
import { AdminDashboard } from "@/components/admin/dashboard/dashboard";
import { PHASE, promotionPhase } from "./promociones/promotion-props";
import { STATE_LABEL, statusReason } from "./tienda/status-labels";

/** `categories.kind` for each product type (the admin's new-category form speaks kinds). */
const KIND_BY_TYPE: Record<string, string> = { burger: "burger", sandwich: "sandwich", fries: "side", beverage: "drink", other: "other" };

/** What the promotion is worth, shown where a product shows its price. */
function valueLabel(mechanic: PromotionMechanic) {
  switch (mechanic.type) {
    case "fixed_price":
      return formatArs(mechanic.fixedPriceCents);
    case "percent_off":
      return `${mechanic.percentOff}% OFF`;
    case "buy_x_get_y":
      return `${mechanic.buyQuantity + mechanic.getQuantity}x${mechanic.buyQuantity}`;
    case "free_delivery":
      return "Envío gratis";
  }
}

/**
 * Control panel (issue #54, capture admin_configuraci_n_precios): store status, prices and stock
 * of products and promotions, and the delivery fee. No metrics: orders, sales and KPIs are out of scope.
 */
export default async function AdminHomePage() {
  const [catalogView, storeView] = await Promise.all([getCatalogAdminView(), getStoreAdminView()]);

  if (!catalogView.ok || !storeView.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="admin-title">
        <h1 id="admin-title">Panel administrativo</h1>
        <p className={styles.error} role="alert">
          No pudimos cargar el panel. Recargá la página en unos segundos.
        </p>
      </section>
    );
  }

  const { catalog } = catalogView.value;
  const { status, catalog: storeCatalog, shifts, mercadoPago } = storeView.value;
  const store = storeCatalog.store;
  const categoryNames = new Map(catalog.categories.map((category) => [category.id, category.name]));
  const now = new Date();
  // Highest priority first, as in the promotion list.
  const promotions = [...storeCatalog.promotions].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  return (
    <section className={styles.adminPanel} aria-labelledby="admin-title">
      <h1 className="sr-only" id="admin-title">Panel administrativo</h1>
      <AdminDashboard
        categories={[...catalog.categories]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((category) => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
            visible: category.visible,
            kind: KIND_BY_TYPE[category.type] ?? "burger",
            productCount: catalog.products.filter((product) => product.categoryId === category.id).length
          }))}
        products={catalog.products.map((product) => ({
          form: formValues(product),
          type: product.type,
          description: product.description,
          categoryName: categoryNames.get(product.categoryId) ?? "",
          imageUrl: product.imageUrl,
          imageStyle: product.imageUrl ? focalStyle(product) : undefined
        }))}
        promotions={promotions.map((rule) => {
          const phase = PHASE[promotionPhase(rule, isPromotionInEffect(rule, now, store.timezone), now)];
          return {
            id: rule.id,
            name: rule.name,
            explanation: explainPromotion(rule),
            badgeText: rule.badgeText,
            phaseLabel: phase.label,
            phaseClass: phase.className,
            active: rule.active,
            valueLabel: valueLabel(rule.mechanic),
            running: isPromotionInEffect(rule, now, store.timezone) && rule.active,
            imageUrl: rule.imageUrl ?? null,
            imageStyle: rule.imageUrl ? focalStyle(rule) : undefined
          };
        })}
        store={{
          state: status.state,
          stateLabel: STATE_LABEL[status.state],
          reason: statusReason(status, store.timezone),
          statusOverride: store.statusOverride,
          deliveryFee: store.deliveryFeeCents === null ? "" : pesos(store.deliveryFeeCents),
          whatsapp: store.whatsappE164
        }}
        settings={{
          deliveryFee: store.deliveryFeeCents === null ? "" : pesos(store.deliveryFeeCents),
          whatsapp: store.whatsappE164,
          pickupAddress: store.pickupAddress ?? "",
          pickupMapsUrl: store.pickupMapsUrl ?? "",
          timezone: store.timezone,
          shifts: [...shifts].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt)),
          paymentMethods: PAYMENT_METHODS.map((method) => {
            const stored = store.paymentMethods.find((candidate) => candidate.method === method);
            return {
              id: method,
              name: PAYMENT_METHOD_NAME[method],
              note: PUBLIC_PAYMENT_NOTE[method],
              enabled: stored?.enabled ?? false,
              sortOrder: stored?.sortOrder ?? (PAYMENT_METHODS.indexOf(method) + 1) * 10
            };
          }).sort((a, b) => a.sortOrder - b.sortOrder),
          mercadoPagoNote: mercadoPago.available ? null : "No aparece en la carta hasta completar su configuración en el servidor."
        }}
      />
    </section>
  );
}
