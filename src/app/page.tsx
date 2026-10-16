import { Storefront } from "@/components/storefront/storefront";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import { getPublicCatalog, getPublicPromotions } from "@/server/catalog";
import { allowsDemoCatalog } from "@/server/catalog/demo-catalog";
import { getMercadoPagoAvailability } from "@/server/payments/mercado-pago-availability";

interface HomeProps {
  searchParams: Promise<{
    producto?: string | string[];
    ref?: string | string[];
    payment_id?: string | string[];
    collection_id?: string | string[];
  }>;
}

/** The minute this render happens in, read outside the component so the render itself stays pure. */
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export default async function Home({ searchParams }: HomeProps) {
  const [params, catalogResult, currentAdmin, promotionsResult] = await Promise.all([
    searchParams,
    getPublicCatalog(),
    getCurrentStoreAdmin(),
    getPublicPromotions()
  ]);
  // Promotions and the minute they were judged at travel with the page, so the banner and the promo
  // prices are in the first paint; the client keeps re-reading them as before.
  const renderedAt = currentMinute();
  const productParam = Array.isArray(params.producto) ? params.producto[0] : params.producto;
  const refParam = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const paymentIdParam =
    (Array.isArray(params.payment_id) ? params.payment_id[0] : params.payment_id) ??
    (Array.isArray(params.collection_id) ? params.collection_id[0] : params.collection_id);
  // The server's snapshot, empty included; null only when it could not be read at all.
  const initialCatalog = catalogResult.ok
    ? { products: catalogResult.value.products, categories: catalogResult.value.categories }
    : null;
  // Offered only when a checkout could actually start (config, store method, durable storage and
  // production quota); a payment method that cannot be read counts as disabled. Never throws.
  const mercadoPago = getMercadoPagoAvailability({
    storePaymentMethods: catalogResult.ok ? catalogResult.value.store.paymentMethods : null
  });
  return (
    <Storefront
      initialProductSlug={productParam ?? null}
      mercadoPagoEnabled={mercadoPago.available}
      showAdminNav={currentAdmin.ok}
      paymentMethods={
        catalogResult.ok
          ? catalogResult.value.store.paymentMethods.filter((method) => method.enabled).map((method) => method.method)
          : undefined
      }
      initialCatalog={initialCatalog}
      catalogFallback={allowsDemoCatalog(catalogResult, process.env.VERCEL_ENV) ? "demo" : "empty"}
      initialReturnReference={refParam ?? null}
      initialReturnPaymentId={paymentIdParam ?? null}
      initialPromotions={promotionsResult.ok ? promotionsResult.value : null}
      renderedAt={renderedAt}
    />
  );
}
