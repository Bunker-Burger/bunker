import { Storefront } from "@/components/storefront/storefront";

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
  const params = await searchParams;
  const productParam = Array.isArray(params.producto) ? params.producto[0] : params.producto;
  return (
    <Storefront
      initialProductSlug={productParam ?? null}
      mercadoPagoEnabled={mercadoPagoConfigured()}
    />
  );
}
