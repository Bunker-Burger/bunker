import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicCatalog } from "@/server/catalog";
import CancellationsPage, { dynamic as cancellationsDynamic, metadata as cancellationsMetadata } from "./cancelaciones/page";
import LegalLayout from "./layout";
import {
  ALLERGEN_NOTICE,
  LEGAL_PAGES,
  LEGAL_REVIEW,
  PAYMENT_DATA_RETENTION_DAYS,
  PAYMENT_DATA_RETENTION_NOTICE
} from "@/content/legal";
import PrivacyPage, { dynamic as privacyDynamic, metadata as privacyMetadata } from "./privacidad/page";
import TermsPage, { dynamic as termsDynamic, metadata as termsMetadata } from "./terminos/page";

vi.mock("@/server/catalog", () => ({ getPublicCatalog: vi.fn() }));

const catalogMock = vi.mocked(getPublicCatalog);
const STORE_WHATSAPP = "+5493865207458";
/* Fixtures only: the owner has not provided an authorized privacy contact yet. */
const CONFIGURED_WHATSAPP = "+5491100000000";
const CONFIGURED_EMAIL = "privacidad@example.com";

/* BB-18: what the legal pages promise, checked against what the code and the database actually do. */

const renderInLayout = (page: ReactNode) => render(<LegalLayout>{page}</LegalLayout>);

const withStore = () =>
  catalogMock.mockResolvedValue({
    ok: true,
    value: { store: { whatsappE164: STORE_WHATSAPP } }
  } as Awaited<ReturnType<typeof getPublicCatalog>>);

beforeEach(() => {
  vi.stubEnv("PRIVACY_CONTACT_WHATSAPP", "");
  vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

/** Every text that tells the customer how long their payment data is kept. */
const EXACT_DELETION = /(?:borra|elimina)n?\s+(?:automáticamente\s+)?a\s+los\s+\d+\s+días/i;

/** `cron.schedule('<job>', '<expression>', '<command>')` of the BB-15 migration. */
function purgeSchedule() {
  const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "20261011180000_bb15_mercado_pago_webhook.sql"), "utf8");
  const call = /select cron\.schedule\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\s*\);/.exec(migration);
  if (!call) throw new Error("no cron.schedule in the BB-15 migration");
  const [, job, expression, command] = call;
  return { job, fields: expression!.split(/\s+/), command };
}

/** Body of the latest definition of `private.purge_expired_payment_data`. */
function purgeBody() {
  const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "20261007081609_complete_bb03_schema.sql"), "utf8");
  const definition = migration.slice(migration.indexOf("create or replace function private.purge_expired_payment_data"));
  return definition.slice(0, definition.indexOf("$$;"));
}

const catalogDown = () => catalogMock.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "down" } });

/** The contact links of the policy (intro and rights), checked to be real, safe and clickable. */
function expectContactLinks(name: string, href: string) {
  const links = screen.getAllByRole("link", { name });
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link).toHaveAttribute("href", href);
    expect(["https:", "mailto:"]).toContain(new URL(link.getAttribute("href")!).protocol);
    const followed: string[] = [];
    link.addEventListener("click", (event) => {
      followed.push((event.currentTarget as HTMLAnchorElement).href);
      event.preventDefault();
    });
    fireEvent.click(link);
    expect(followed).toEqual([href]);
  }
}

describe("privacidad", () => {
  it("describes data, purpose, recipients, retention and the contact channel", async () => {
    withStore();
    renderInLayout(await PrivacyPage());

    for (const label of ["Qué datos:", "Para qué:", "Con quién:", "Cuánto tiempo:"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/nombre y apellido y tu teléfono/)).toBeInTheDocument();
    expectContactLinks(STORE_WHATSAPP, "https://wa.me/5493865207458");
    expect(screen.getByText(/No usamos tus datos para publicidad/)).toBeInTheDocument();
    expect(screen.getByText(/No guardamos direcciones/)).toBeInTheDocument();
    expect(screen.getByText(/AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA/)).toBeInTheDocument();
  });

  it("is rendered per request, so the contact is never frozen at build time", () => {
    expect(privacyDynamic).toBe("force-dynamic");
  });

  describe("contacto con la carta caída (R1 H2)", () => {
    it("uses the WhatsApp configured by the owner, which does not depend on the database", async () => {
      catalogDown();
      vi.stubEnv("PRIVACY_CONTACT_WHATSAPP", CONFIGURED_WHATSAPP);
      renderInLayout(await PrivacyPage());

      expectContactLinks(CONFIGURED_WHATSAPP, "https://wa.me/5491100000000");
    });

    it("or the configured email", async () => {
      catalogDown();
      vi.stubEnv("PRIVACY_CONTACT_EMAIL", CONFIGURED_EMAIL);
      renderInLayout(await PrivacyPage());

      expectContactLinks(CONFIGURED_EMAIL, `mailto:${CONFIGURED_EMAIL}`);
    });

    it("prefers the store's WhatsApp from the catalog when it answers", async () => {
      withStore();
      vi.stubEnv("PRIVACY_CONTACT_WHATSAPP", CONFIGURED_WHATSAPP);
      renderInLayout(await PrivacyPage());

      expectContactLinks(STORE_WHATSAPP, "https://wa.me/5493865207458");
      expect(screen.queryByRole("link", { name: CONFIGURED_WHATSAPP })).toBeNull();
    });

    it("without catalog nor configuration it says the channel is pending: no invented contact", async () => {
      catalogDown();
      renderInLayout(await PrivacyPage());

      expect(screen.getAllByText("el canal de contacto para privacidad todavía no fue cargado por el titular")).toHaveLength(2);
      expect(screen.queryByRole("link", { name: /^\+|@/ })).toBeNull();
    });

    it("ignores a malformed configuration instead of linking to it", async () => {
      catalogDown();
      vi.stubEnv("PRIVACY_CONTACT_WHATSAPP", "javascript:alert(1)");
      vi.stubEnv("PRIVACY_CONTACT_EMAIL", "a@b.com?bcc=x@y.com");
      renderInLayout(await PrivacyPage());

      expect(screen.getAllByText(/todavía no fue cargado por el titular/)).toHaveLength(2);
    });
  });

  describe("retención (R1 H1)", () => {
    it("the policy says a daily purge, not an exact deletion", async () => {
      withStore();
      const { container } = renderInLayout(await PrivacyPage());

      expect(container.textContent).toContain(PAYMENT_DATA_RETENTION_NOTICE);
      expect(container.textContent).not.toMatch(EXACT_DELETION);
      expect(PAYMENT_DATA_RETENTION_NOTICE).not.toMatch(EXACT_DELETION);
      expect(PAYMENT_DATA_RETENTION_NOTICE).toMatch(/purga diaria/);
      expect(PAYMENT_DATA_RETENTION_NOTICE).toMatch(/no se borran en el instante exacto/);
    });

    it("matches the job actually scheduled: once a day, running the purge", () => {
      const { job, fields, command } = purgeSchedule();
      expect(job).toBe("bb15-purge-expired-payment-data");
      expect(command).toBe("select private.purge_expired_payment_data()");
      // minute hour day-of-month month day-of-week: one fixed time, every day.
      expect(fields).toHaveLength(5);
      const [minute, hour, ...everyDay] = fields;
      expect(minute).toMatch(/^\d{1,2}$/);
      expect(hour).toMatch(/^\d{1,2}$/);
      expect(everyDay).toEqual(["*", "*", "*"]);
    });

    it("matches the purge: what is older than the retention, by creation time", () => {
      const conditions = purgeBody().match(/[\w.]+ < now\(\) - interval '\d+ days'/g);
      expect(conditions).toEqual([
        `pa.created_at < now() - interval '${PAYMENT_DATA_RETENTION_DAYS} days'`,
        `pq.created_at < now() - interval '${PAYMENT_DATA_RETENTION_DAYS} days'`,
        `created_at < now() - interval '${PAYMENT_DATA_RETENTION_DAYS} days'`,
        `received_at < now() - interval '${PAYMENT_DATA_RETENTION_DAYS} days'`
      ]);
    });
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

describe("en revisión: fuera del pie de la carta y de los buscadores", () => {
  it("the legal texts are not approved", () => {
    expect(LEGAL_REVIEW.approved).toBe(false);
  });

  it.each([
    ["/legal/terminos", termsMetadata],
    ["/legal/privacidad", privacyMetadata],
    ["/legal/cancelaciones", cancellationsMetadata]
  ])("%s asks search engines not to index nor follow it", (_path, metadata) => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("every legal URL is still a page of the app, reachable directly", () => {
    expect(LEGAL_PAGES.map((page) => page.href)).toEqual(["/legal/terminos", "/legal/privacidad", "/legal/cancelaciones"]);
    for (const { href } of LEGAL_PAGES) {
      expect(existsSync(join(process.cwd(), "src", "app", ...href.slice(1).split("/"), "page.tsx"))).toBe(true);
    }
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
