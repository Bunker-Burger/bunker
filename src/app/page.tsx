import { Storefront } from "@/components/storefront/storefront";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import { getPublicCatalog } from "@/server/catalog";

interface HomeProps {
  searchParams: Promise<{ producto?: string | string[] }>;
}

// Checkout Pro is only offered when every Mercado Pago variable is present.
function mercadoPagoConfigured() {
  return Boolean(
    process.env.MERCADOPAGO_ACCESS_TOKEN &&
      process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY &&
      process.env.MERCADOPAGO_WEBHOOK_SECRET
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const [params, catalogResult, currentAdmin] = await Promise.all([
    searchParams,
    getPublicCatalog(),
    getCurrentStoreAdmin()
  ]);
  const productParam = Array.isArray(params.producto) ? params.producto[0] : params.producto;
  // The server's snapshot, empty included; null only when it could not be read at all.
  const initialCatalog = catalogResult.ok
    ? { products: catalogResult.value.products, categories: catalogResult.value.categories }
    : null;
  return (
    <Storefront
      initialProductSlug={productParam ?? null}
      mercadoPagoEnabled={mercadoPagoConfigured()}
      showAdminNav={currentAdmin.ok}
      paymentMethods={
        catalogResult.ok
          ? catalogResult.value.store.paymentMethods.filter((method) => method.enabled).map((method) => method.method)
          : undefined
      }
      initialCatalog={initialCatalog}
    />
  );
}
