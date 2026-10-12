import { focalStyle } from "@/components/storefront/focal-style";
import { explainPromotion, isPromotionInEffect } from "@/domain/promotions";
import type { PromotionMechanic } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { getCatalogAdminView } from "@/server/catalog-admin";
import { getStoreAdminView } from "@/server/store-admin";
import styles from "../admin.module.css";
import { formValues, pesos } from "./catalogo/product-props";
import { AdminDashboard } from "./dashboard";
import { PHASE, promotionPhase } from "./promociones/promotion-props";
import { STATE_LABEL, statusReason } from "./tienda/status-labels";

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
  const { status, catalog: storeCatalog } = storeView.value;
  const store = storeCatalog.store;
  const categoryNames = new Map(catalog.categories.map((category) => [category.id, category.name]));
  const now = new Date();
  // Highest priority first, as in the promotion list.
  const promotions = [...storeCatalog.promotions].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  return (
    <section className={styles.adminPanel} aria-labelledby="admin-title">
      <h1 className="sr-only" id="admin-title">Panel administrativo</h1>
      <AdminDashboard
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
            running: isPromotionInEffect(rule, now, store.timezone) && rule.active
          };
        })}
        store={{
          state: status.state,
          stateLabel: STATE_LABEL[status.state],
          reason: statusReason(status, store.timezone),
          deliveryFee: store.deliveryFeeCents === null ? "" : pesos(store.deliveryFeeCents),
          whatsapp: store.whatsappE164
        }}
      />
    </section>
  );
}
