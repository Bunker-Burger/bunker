import { focalStyle } from "@/components/storefront/focal-style";
import { explainPromotion, isPromotionInEffect } from "@/domain/promotions";
import { getCatalogAdminView } from "@/server/catalog-admin";
import { getStoreAdminView } from "@/server/store-admin";
import styles from "../admin.module.css";
import { formValues, pesos } from "./catalogo/product-props";
import { AdminDashboard } from "./dashboard";
import { PHASE, promotionPhase } from "./promociones/promotion-props";
import { OVERRIDE_OPTIONS, STATE_LABEL, statusReason } from "./tienda/status-labels";

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
            active: rule.active
          };
        })}
        store={{
          state: status.state,
          stateLabel: STATE_LABEL[status.state],
          reason: statusReason(status, store.timezone),
          statusOverride: store.statusOverride,
          overrideOptions: OVERRIDE_OPTIONS,
          deliveryFee: store.deliveryFeeCents === null ? "" : pesos(store.deliveryFeeCents),
          whatsapp: store.whatsappE164
        }}
      />
    </section>
  );
}
