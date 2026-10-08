import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { LoginForm } from "@/components/admin/login-form";
import { PurgeAdminCaches } from "@/components/admin/purge-admin-caches";
import { getAdminSession } from "@/server/auth/session";
import { safeAdminPath } from "@/server/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Ingresar | Administración Búnker Burger",
  robots: { index: false, follow: false }
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[]; sesion?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeAdminPath(first(params.next));
  const session = await getAdminSession();
  if (session.ok) redirect(next);

  const signedOut = first(params.sesion) === "cerrada";
  const unavailable = session.error.code !== "unauthorized";

  return (
    <AdminShell signedIn={false}>
      <PurgeAdminCaches />
      <section aria-labelledby="login-title" className="mx-auto grid max-w-md gap-6 py-10">
        <div className="grid gap-2">
          <p className="m-0 text-badge font-bold uppercase tracking-eyebrow text-primary">Acceso restringido</p>
          <h1 className="m-0 font-display text-headline-lg font-bold uppercase" id="login-title">
            Ingresar al panel
          </h1>
          <p className="m-0 text-body-lg text-muted">Solo para administradores habilitados por Búnker Burger. No hay registro público.</p>
        </div>
        {signedOut ? (
          <p className="m-0 rounded-md border border-border-strong bg-surface-high px-3 py-2 text-body" role="status">
            Cerraste sesión en este dispositivo.
          </p>
        ) : null}
        {unavailable ? (
          <p className="m-0 rounded-md border border-danger bg-danger-soft px-3 py-2 text-body" role="alert">
            No pudimos verificar la sesión. Podés intentar ingresar de nuevo.
          </p>
        ) : null}
        <LoginForm next={next} />
      </section>
    </AdminShell>
  );
}
