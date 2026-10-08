import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { signOut } from "@/app/bunker/actions";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/state-message";
import { requireAdminSession } from "@/server/auth/session";
import { getAdminCatalog } from "@/server/catalog";

export const metadata: Metadata = {
  title: "Panel | Administración Búnker Burger",
  robots: { index: false, follow: false }
};

const ROLE_LABELS = { owner: "Dueño", admin: "Administrador" } as const;

export default async function AdminHomePage() {
  // Server-side gate: anyone who is not an active admin of this store is sent to the login.
  const session = await requireAdminSession("/bunker/admin");
  if (!session.ok) {
    return (
      <AdminShell signedIn={false}>
        <div className="py-10">
          <ErrorState description="No pudimos verificar tu acceso. Recargá la página en unos minutos." title="Panel no disponible" />
        </div>
      </AdminShell>
    );
  }

  // Read with the admin's own session: RLS returns the store's full catalog only to its admins.
  const catalog = await getAdminCatalog();
  const counts = catalog.ok
    ? [
        { label: "Categorías", value: catalog.value.categories.length },
        { label: "Productos", value: catalog.value.products.length },
        { label: "Publicados", value: catalog.value.products.filter((product) => product.published).length },
        { label: "Promociones", value: catalog.value.promotions.length }
      ]
    : null;

  return (
    <AdminShell signedIn>
      <section aria-labelledby="admin-title" className="grid gap-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-2">
            <p className="m-0 text-badge font-bold uppercase tracking-eyebrow text-primary">{ROLE_LABELS[session.value.role]}</p>
            <h1 className="m-0 font-display text-headline-lg font-bold uppercase" id="admin-title">
              Panel de administración
            </h1>
            {session.value.email ? <p className="m-0 text-body text-muted">Sesión iniciada como {session.value.email}</p> : null}
          </div>
          <form action={signOut}>
            <Button size="sm" type="submit" variant="secondary">
              <LogOut aria-hidden="true" />
              Cerrar sesión
            </Button>
          </form>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Catálogo de la tienda</CardTitle>
          </CardHeader>
          <CardContent>
            {counts ? (
              <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-4">
                {counts.map(({ label, value }) => (
                  <div className="grid gap-1" key={label}>
                    <dt className="text-body-sm font-bold uppercase tracking-label text-muted">{label}</dt>
                    <dd className="m-0 font-display text-headline-md font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="m-0 text-body text-muted" role="alert">
                No pudimos leer el catálogo en este momento.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}
