import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { accounts, AUTH_COOKIE, installFakeSupabase, issueSession, sessionCookieValue, stubSupabaseEnv, type FakeSupabase } from "@/test/fake-supabase-auth";
import { redirectedTo } from "@/test/redirects";
import AdminHomePage from "./admin/page";
import LoginPage from "./page";

/*
 * The routes themselves, rendered as Next renders them on the server, with the real session
 * checks; only the network to Supabase and the request cookies are faked.
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => {
      if (value === "" || options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    }
  })
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

let fake: FakeSupabase;

beforeEach(() => {
  jar.clear();
  localStorage.clear();
  stubSupabaseEnv();
  fake = installFakeSupabase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const signedInAs = (user: (typeof accounts)[keyof typeof accounts], options: { expired?: boolean } = {}) =>
  jar.set(AUTH_COOKIE, sessionCookieValue(issueSession(fake, user, options)));

const params = (value: Record<string, string> = {}) => ({ searchParams: Promise.resolve(value) });
const navigation = () => within(screen.getByRole("navigation", { name: "Navegación principal" }));

describe("/bunker/admin", () => {
  it("sends anonymous visitors to the login", async () => {
    expect(await redirectedTo(() => AdminHomePage())).toBe("/bunker");
  });

  it.each([
    ["user_metadata claiming admin", accounts.metadataAdmin],
    ["admin of another store", accounts.otherStore],
    ["inactive membership", accounts.inactive]
  ])("sends a signed-in non-admin (%s) to the login", async (_case, user) => {
    signedInAs(user);
    expect(await redirectedTo(() => AdminHomePage())).toBe("/bunker");
  });

  it("sends an expired, unrefreshable session to the login", async () => {
    signedInAs(accounts.admin, { expired: true });
    for (const issued of fake.sessions) issued.revoked = true;
    expect(await redirectedTo(() => AdminHomePage())).toBe("/bunker");
  });

  it("shows the panel, the Admin tab and sign out to an active admin", async () => {
    signedInAs(accounts.admin);
    render(await AdminHomePage());

    expect(screen.getByRole("heading", { name: "Panel de administración" })).toBeInTheDocument();
    expect(screen.getByText(`Sesión iniciada como ${accounts.admin.email}`)).toBeInTheDocument();
    expect(screen.getByText("Dueño")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(navigation().getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
    expect(navigation().getByRole("link", { name: "Menú" })).toHaveAttribute("href", "/");
  });

  it("shows an error, and nothing administrative, when the check cannot run", async () => {
    signedInAs(accounts.admin);
    fake.failAuth = { path: "/user", status: 503 };
    render(await AdminHomePage());

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos verificar tu acceso");
    expect(screen.queryByRole("heading", { name: "Panel de administración" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(navigation().queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });
});

describe("/bunker (login)", () => {
  it("shows email and password only, without sign-up, and no Admin tab", async () => {
    render(await LoginPage(params()));

    expect(screen.getByRole("heading", { name: "Ingresar al panel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeInTheDocument();
    expect(screen.queryByText(/registr|crear cuenta/i, { selector: "a, button" })).not.toBeInTheDocument();
    expect(navigation().queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("keeps only a safe destination for after signing in", async () => {
    const { container } = render(await LoginPage(params({ next: "https://evil.example/bunker/admin" })));
    expect(container.querySelector('input[name="next"]')).toHaveValue("/bunker/admin");
  });

  it("sends an admin who is already signed in straight to the (safe) destination", async () => {
    signedInAs(accounts.admin);
    expect(await redirectedTo(() => LoginPage(params({ next: "/bunker/admin/productos" })))).toBe("/bunker/admin/productos");
    expect(await redirectedTo(() => LoginPage(params({ next: "//evil.example" })))).toBe("/bunker/admin");
  });

  it("does not let a signed-in non-admin through", async () => {
    signedInAs(accounts.metadataAdmin);
    render(await LoginPage(params()));
    expect(screen.getByRole("heading", { name: "Ingresar al panel" })).toBeInTheDocument();
  });

  it("confirms the sign out", async () => {
    render(await LoginPage(params({ sesion: "cerrada" })));
    expect(screen.getByRole("status")).toHaveTextContent("Cerraste sesión en este dispositivo.");
  });
});

describe("Admin tab in the storefront (/)", () => {
  // The storefront's own status/promotions requests are irrelevant here.
  const showAdminNav = async () => {
    const element = (await Home(params())) as { props: { showAdminNav: boolean } };
    return element.props.showAdminNav;
  };

  it("appears only during a valid admin session", async () => {
    expect(await showAdminNav()).toBe(false);

    signedInAs(accounts.metadataAdmin);
    expect(await showAdminNav()).toBe(false);

    jar.clear();
    signedInAs(accounts.otherStore);
    expect(await showAdminNav()).toBe(false);

    jar.clear();
    signedInAs(accounts.admin);
    expect(await showAdminNav()).toBe(true);
  });
});
