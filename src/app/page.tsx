import { Storefront } from "@/components/storefront/storefront";
import { getPublicCatalog } from "@/server/catalog";
import { detectMercadoPagoConfig } from "@/server/payments/mercado-pago";

interface HomeProps {
  searchParams: Promise<{
    producto?: string | string[];
    ref?: string | string[];
    payment_id?: string | string[];
    collection_id?: string | string[];
  }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const productParam = Array.isArray(params.producto) ? params.producto[0] : params.producto;
  const refParam = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const paymentIdParam =
    (Array.isArray(params.payment_id) ? params.payment_id[0] : params.payment_id) ??
    (Array.isArray(params.collection_id) ? params.collection_id[0] : params.collection_id);
  const catalogResult = await getPublicCatalog();
  // The server's snapshot, empty included; null only when it could not be read at all.
  const initialCatalog = catalogResult.ok
    ? { products: catalogResult.value.products, categories: catalogResult.value.categories }
    : null;
  return (
    <Storefront
      initialProductSlug={productParam ?? null}
      mercadoPagoEnabled={detectMercadoPagoConfig().enabled}
      paymentMethods={
        catalogResult.ok
          ? catalogResult.value.store.paymentMethods.filter((method) => method.enabled).map((method) => method.method)
          : undefined
      }
      initialCatalog={initialCatalog}
      initialReturnReference={refParam ?? null}
      initialReturnPaymentId={paymentIdParam ?? null}
    />
  );
}
