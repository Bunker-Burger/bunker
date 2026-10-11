import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicCatalog } from "@/server/catalog";
import CancellationsPage, { dynamic as cancellationsDynamic } from "./cancelaciones/page";
import LegalLayout from "./layout";
import { ALLERGEN_NOTICE, LEGAL_PAGES, LEGAL_REVIEW, PAYMENT_DATA_RETENTION_DAYS } from "@/content/legal";
import PrivacyPage from "./privacidad/page";
import TermsPage, { dynamic as termsDynamic } from "./terminos/page";

vi.mock("@/server/catalog", () => ({ getPublicCatalog: vi.fn() }));

const catalogMock = vi.mocked(getPublicCatalog);
const STORE_WHATSAPP = "+5493865207458";

/* BB-18: what the legal pages promise, checked against what the code and the database actually do. */

const renderInLayout = (page: ReactNode) => render(<LegalLayout>{page}</LegalLayout>);

const withStore = () =>
  catalogMock.mockResolvedValue({
    ok: true,
    value: { store: { whatsappE164: STORE_WHATSAPP } }
  } as Awaited<ReturnType<typeof getPublicCatalog>>);

afterEach(() => {
  vi.resetAllMocks();
});

describe("privacidad", () => {
  it("describes data, purpose, recipients, retention and the contact channel", async () => {
    withStore();
    renderInLayout(await PrivacyPage());

    for (const label of ["Qué datos:", "Para qué:", "Con quién:", "Cuánto tiempo:"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/nombre y apellido y tu teléfono/)).toBeInTheDocument();
    expect(screen.getByText(/se borran automáticamente a los 90 días de iniciado/)).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: STORE_WHATSAPP })) {
      expect(link).toHaveAttribute("href", "https://wa.me/5493865207458");
    }
    expect(screen.getAllByRole("link", { name: STORE_WHATSAPP })).toHaveLength(2);
    expect(screen.getByText(/No usamos tus datos para publicidad/)).toBeInTheDocument();
    expect(screen.getByText(/No guardamos direcciones/)).toBeInTheDocument();
    expect(screen.getByText(/AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA/)).toBeInTheDocument();
  });

  it("still names the contact channel when the store cannot be read", async () => {
    catalogMock.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "down" } });
    renderInLayout(await PrivacyPage());

    expect(screen.getAllByText(/por WhatsApp, al mismo número al que se envían los pedidos/)).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^\+/ })).toBeNull();
  });

  it("states the retention the database purge actually applies", () => {
    const migrations = join(process.cwd(), "supabase", "migrations");
    const purge = readFileSync(join(migrations, "20261007081609_complete_bb03_schema.sql"), "utf8");
    const definition = purge.slice(purge.indexOf("create or replace function private.purge_expired_payment_data"));
    const body = definition.slice(0, definition.indexOf("$$;"));
    // Attempts (name, phone), quotes and webhook events all go after the same period.
    expect(body.match(/interval '(\d+) days'/g)).toEqual(Array(4).fill(`interval '${PAYMENT_DATA_RETENTION_DAYS} days'`));
    const cron = readFileSync(join(migrations, "20261011180000_bb15_mercado_pago_webhook.sql"), "utf8");
    expect(cron).toContain("'select private.purge_expired_payment_data()'");
  });
});

describe("términos y cancelaciones", () => {
  it("terms say the menu carries no allergen information and the site issues no invoices", () => {
    renderInLayout(<TermsPage />);

    expect(screen.getByText(new RegExp(ALLERGEN_NOTICE.slice(0, 40)))).toBeInTheDocument();
    expect(screen.getByText(/La web no emite facturas ni otros comprobantes fiscales/)).toBeInTheDocument();
    expect(screen.getByText(/no informa ni garantiza tiempos de preparación o de entrega/)).toBeInTheDocument();
  });

  it("refunds are total and promise no term", () => {
    renderInLayout(<CancellationsPage />);

    expect(screen.getByText(/devuelve el pago completo/)).toBeInTheDocument();
    expect(screen.getByText(/no podemos prometerte un plazo/)).toBeInTheDocument();
  });

  it("no page promises a term or a time other than the data retention", async () => {
    withStore();
    const texts = [
      renderInLayout(<TermsPage />).container.textContent,
      renderInLayout(<CancellationsPage />).container.textContent,
      renderInLayout(await PrivacyPage()).container.textContent
    ].join("\n");

    expect(texts.match(/\d+\s*(?:días|horas|hs\b|minutos|semanas)/gi)).toEqual([`${PAYMENT_DATA_RETENTION_DAYS} días`]);
    expect(texts).not.toMatch(/hábiles|inmediat|garantizamos|reembolso automático/i);
  });

  it("are static pages", () => {
    expect(termsDynamic).toBe("force-static");
    expect(cancellationsDynamic).toBe("force-static");
  });
});

describe("layout legal", () => {
  it("says the texts are under review and shows the owner's identity as pending until it is provided", () => {
    renderInLayout(<TermsPage />);

    expect(LEGAL_REVIEW.approved).toBe(false);
    expect(screen.getByRole("note")).toHaveTextContent("Texto en revisión");
    expect(screen.getByText(/Titular: pendiente de carga por el titular/)).toBeInTheDocument();
  });

  it("links every legal page and back to the menu", () => {
    renderInLayout(<TermsPage />);

    const nav = screen.getByRole("navigation", { name: "Textos legales" });
    for (const page of LEGAL_PAGES) {
      expect(nav.querySelector(`a[href="${page.href}"]`)).toHaveTextContent(page.label);
    }
    expect(screen.getByRole("link", { name: "← Volver a la carta" })).toHaveAttribute("href", "/");
  });
});
